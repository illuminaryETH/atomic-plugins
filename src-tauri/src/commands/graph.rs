//! Semantic graph operations

use crate::db::Database;
use crate::embedding::compute_semantic_edges_for_atom;
use crate::models::{
    Atom, AtomWithTags, NeighborhoodAtom, NeighborhoodEdge, NeighborhoodGraph, SemanticEdge,
};
use std::collections::HashMap;
use tauri::State;

use super::helpers::get_tags_for_atom;

/// Get all semantic edges for global graph view
#[tauri::command]
pub fn get_semantic_edges(
    db: State<Database>,
    min_similarity: f32,
) -> Result<Vec<SemanticEdge>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, source_atom_id, target_atom_id, similarity_score,
                    source_chunk_index, target_chunk_index, created_at
             FROM semantic_edges
             WHERE similarity_score >= ?1
             ORDER BY similarity_score DESC",
        )
        .map_err(|e| format!("Failed to prepare semantic edges query: {}", e))?;

    let edges = stmt
        .query_map([min_similarity], |row| {
            Ok(SemanticEdge {
                id: row.get(0)?,
                source_atom_id: row.get(1)?,
                target_atom_id: row.get(2)?,
                similarity_score: row.get(3)?,
                source_chunk_index: row.get(4)?,
                target_chunk_index: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("Failed to query semantic edges: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect semantic edges: {}", e))?;

    Ok(edges)
}

/// Get neighborhood graph for an atom (for local graph view)
/// Returns the center atom, connected atoms at depth 1 (and optionally depth 2),
/// and all edges between them (both semantic and tag-based)
#[tauri::command]
pub fn get_atom_neighborhood(
    db: State<Database>,
    atom_id: String,
    depth: i32,
    min_similarity: f32,
) -> Result<NeighborhoodGraph, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Track atoms at each depth
    let mut atoms_at_depth: HashMap<String, i32> = HashMap::new();
    atoms_at_depth.insert(atom_id.clone(), 0);

    // Get depth 1 connections (semantic edges)
    let depth1_semantic: Vec<(String, f32)> = {
        let mut stmt = conn
            .prepare(
                "SELECT
                    CASE WHEN source_atom_id = ?1 THEN target_atom_id ELSE source_atom_id END as other_atom_id,
                    similarity_score
                 FROM semantic_edges
                 WHERE (source_atom_id = ?1 OR target_atom_id = ?1)
                   AND similarity_score >= ?2
                 ORDER BY similarity_score DESC
                 LIMIT 20",
            )
            .map_err(|e| e.to_string())?;

        let results = stmt
            .query_map(rusqlite::params![&atom_id, min_similarity], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        results
    };

    // Add depth 1 atoms
    for (other_id, _) in &depth1_semantic {
        atoms_at_depth.entry(other_id.clone()).or_insert(1);
    }

    // Get depth 1 connections (tag-based)
    let center_tags: Vec<String> = {
        let mut stmt = conn
            .prepare("SELECT tag_id FROM atom_tags WHERE atom_id = ?1")
            .map_err(|e| e.to_string())?;
        let results = stmt
            .query_map([&atom_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        results
    };

    // Find atoms sharing tags with center atom
    let depth1_tags: Vec<(String, i32)> = if !center_tags.is_empty() {
        let placeholders: String = center_tags.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let query = format!(
            "SELECT atom_id, COUNT(*) as shared_count
             FROM atom_tags
             WHERE tag_id IN ({})
               AND atom_id != ?
             GROUP BY atom_id
             HAVING shared_count >= 1
             ORDER BY shared_count DESC
             LIMIT 20",
            placeholders
        );

        let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

        let mut params: Vec<&dyn rusqlite::ToSql> = center_tags
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();
        params.push(&atom_id);

        let results = stmt
            .query_map(params.as_slice(), |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        results
    } else {
        Vec::new()
    };

    // Add tag-connected atoms to depth 1
    for (other_id, _) in &depth1_tags {
        atoms_at_depth.entry(other_id.clone()).or_insert(1);
    }

    // If depth == 2, find second-degree connections
    if depth >= 2 {
        let depth1_ids: Vec<String> = atoms_at_depth
            .iter()
            .filter(|(_, d)| **d == 1)
            .map(|(id, _)| id.clone())
            .collect();

        for d1_id in &depth1_ids {
            // Get semantic edges from depth 1 atoms
            let mut stmt = conn
                .prepare(
                    "SELECT
                        CASE WHEN source_atom_id = ?1 THEN target_atom_id ELSE source_atom_id END as other_atom_id
                     FROM semantic_edges
                     WHERE (source_atom_id = ?1 OR target_atom_id = ?1)
                       AND similarity_score >= ?2
                     ORDER BY similarity_score DESC
                     LIMIT 5",
                )
                .map_err(|e| e.to_string())?;

            let depth2_ids: Vec<String> = stmt
                .query_map(rusqlite::params![d1_id, min_similarity], |row| row.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;

            for d2_id in depth2_ids {
                atoms_at_depth.entry(d2_id).or_insert(2);
            }
        }
    }

    // Limit total atoms to prevent overwhelming the UI
    let max_atoms = if depth >= 2 { 30 } else { 20 };
    let mut sorted_atoms: Vec<(String, i32)> = atoms_at_depth.into_iter().collect();
    sorted_atoms.sort_by_key(|(_, d)| *d);
    sorted_atoms.truncate(max_atoms);

    let atom_ids: Vec<String> = sorted_atoms.iter().map(|(id, _)| id.clone()).collect();
    let atom_depths: HashMap<String, i32> = sorted_atoms.into_iter().collect();

    // Fetch atom data for all atoms in neighborhood
    let mut atoms: Vec<NeighborhoodAtom> = Vec::new();
    for aid in &atom_ids {
        let atom: Atom = conn
            .query_row(
                "SELECT id, content, source_url, created_at, updated_at,
                        COALESCE(embedding_status, 'pending'), COALESCE(tagging_status, 'pending')
                 FROM atoms WHERE id = ?1",
                [aid],
                |row| {
                    Ok(Atom {
                        id: row.get(0)?,
                        content: row.get(1)?,
                        source_url: row.get(2)?,
                        created_at: row.get(3)?,
                        updated_at: row.get(4)?,
                        embedding_status: row.get(5)?,
                        tagging_status: row.get(6)?,
                    })
                },
            )
            .map_err(|e| format!("Failed to get atom {}: {}", aid, e))?;

        let tags = get_tags_for_atom(&conn, aid)?;
        let depth = *atom_depths.get(aid).unwrap_or(&0);

        atoms.push(NeighborhoodAtom {
            atom: AtomWithTags { atom, tags },
            depth,
        });
    }

    // Build edges between all atoms in the neighborhood
    let mut edges: Vec<NeighborhoodEdge> = Vec::new();

    // Get semantic edges between neighborhood atoms
    for i in 0..atom_ids.len() {
        for j in (i + 1)..atom_ids.len() {
            let id_a = &atom_ids[i];
            let id_b = &atom_ids[j];

            // Check for semantic edge
            let semantic_score: Option<f32> = conn
                .query_row(
                    "SELECT similarity_score FROM semantic_edges
                     WHERE (source_atom_id = ?1 AND target_atom_id = ?2)
                        OR (source_atom_id = ?2 AND target_atom_id = ?1)",
                    [id_a, id_b],
                    |row| row.get(0),
                )
                .ok();

            // Check for shared tags
            let shared_tags: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM atom_tags a1
                     INNER JOIN atom_tags a2 ON a1.tag_id = a2.tag_id
                     WHERE a1.atom_id = ?1 AND a2.atom_id = ?2",
                    [id_a, id_b],
                    |row| row.get(0),
                )
                .unwrap_or(0);

            // Only include edge if there's a connection
            if semantic_score.is_some() || shared_tags > 0 {
                let edge_type = match (semantic_score.is_some(), shared_tags > 0) {
                    (true, true) => "both",
                    (true, false) => "semantic",
                    (false, true) => "tag",
                    (false, false) => continue,
                };

                // Calculate combined strength
                let semantic_strength = semantic_score.unwrap_or(0.0);
                let tag_strength = (shared_tags as f32 * 0.15).min(0.6);
                let strength = (semantic_strength + tag_strength).min(1.0);

                edges.push(NeighborhoodEdge {
                    source_id: id_a.clone(),
                    target_id: id_b.clone(),
                    edge_type: edge_type.to_string(),
                    strength,
                    shared_tag_count: shared_tags,
                    similarity_score: semantic_score,
                });
            }
        }
    }

    Ok(NeighborhoodGraph {
        center_atom_id: atom_id,
        atoms,
        edges,
    })
}

/// Rebuild semantic edges for all atoms with embeddings
/// Used for migrating existing databases to include semantic edges
#[tauri::command]
pub fn rebuild_semantic_edges(db: State<Database>) -> Result<i32, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get all atoms with complete embeddings
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT a.id FROM atoms a
             INNER JOIN atom_chunks ac ON a.id = ac.atom_id
             WHERE a.embedding_status = 'complete'",
        )
        .map_err(|e| format!("Failed to prepare atom query: {}", e))?;

    let atom_ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| format!("Failed to query atoms: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Failed to collect atom IDs: {}", e))?;

    // Clear existing edges
    conn.execute("DELETE FROM semantic_edges", [])
        .map_err(|e| format!("Failed to clear existing edges: {}", e))?;

    let mut total_edges = 0;

    // Process each atom
    for (idx, atom_id) in atom_ids.iter().enumerate() {
        match compute_semantic_edges_for_atom(&conn, atom_id, 0.5, 15) {
            Ok(edge_count) => {
                total_edges += edge_count;
                if (idx + 1) % 50 == 0 {
                    eprintln!(
                        "Processed {}/{} atoms, {} edges so far",
                        idx + 1,
                        atom_ids.len(),
                        total_edges
                    );
                }
            }
            Err(e) => {
                eprintln!(
                    "Warning: Failed to compute edges for atom {}: {}",
                    atom_id, e
                );
            }
        }
    }

    eprintln!(
        "Rebuild complete: {} atoms processed, {} total edges",
        atom_ids.len(),
        total_edges
    );
    Ok(total_edges)
}
