//! Clustering operations

use crate::clustering;
use crate::db::Database;
use crate::models::AtomCluster;
use std::collections::HashMap;
use tauri::State;

use super::helpers::get_dominant_tags_for_cluster;

/// Compute atom clusters based on semantic edges
#[tauri::command]
pub fn compute_clusters(
    db: State<Database>,
    min_similarity: Option<f32>,
    min_cluster_size: Option<i32>,
) -> Result<Vec<AtomCluster>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let threshold = min_similarity.unwrap_or(0.5);
    let min_size = min_cluster_size.unwrap_or(2);

    let clusters = clustering::compute_atom_clusters(&conn, threshold, min_size)?;

    // Save cluster assignments
    clustering::save_cluster_assignments(&conn, &clusters)?;

    Ok(clusters)
}

/// Get current cluster assignments
#[tauri::command]
pub fn get_clusters(db: State<Database>) -> Result<Vec<AtomCluster>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Check if we have cached clusters
    let count: i32 = conn
        .query_row("SELECT COUNT(*) FROM atom_clusters", [], |row| row.get(0))
        .unwrap_or(0);

    if count == 0 {
        // No clusters cached, compute them
        let clusters = clustering::compute_atom_clusters(&conn, 0.5, 2)?;
        clustering::save_cluster_assignments(&conn, &clusters)?;
        return Ok(clusters);
    }

    // Rebuild clusters from cached assignments
    let mut stmt = conn
        .prepare(
            "SELECT ac.cluster_id, GROUP_CONCAT(ac.atom_id)
             FROM atom_clusters ac
             GROUP BY ac.cluster_id
             ORDER BY COUNT(*) DESC",
        )
        .map_err(|e| e.to_string())?;

    let clusters: Vec<AtomCluster> = stmt
        .query_map([], |row| {
            let cluster_id: i32 = row.get(0)?;
            let atom_ids_str: String = row.get(1)?;
            let atom_ids: Vec<String> = atom_ids_str.split(',').map(|s| s.to_string()).collect();
            Ok((cluster_id, atom_ids))
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .map(|(cluster_id, atom_ids)| {
            // Get dominant tags for this cluster
            let dominant_tags = get_dominant_tags_for_cluster(&conn, &atom_ids).unwrap_or_default();
            AtomCluster {
                cluster_id,
                atom_ids,
                dominant_tags,
            }
        })
        .collect();

    Ok(clusters)
}

/// Get connection counts for each atom (for hub identification)
#[tauri::command]
pub fn get_connection_counts(
    db: State<Database>,
    min_similarity: Option<f32>,
) -> Result<HashMap<String, i32>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let threshold = min_similarity.unwrap_or(0.5);

    clustering::get_connection_counts(&conn, threshold)
}
