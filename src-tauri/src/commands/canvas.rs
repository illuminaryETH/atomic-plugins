//! Canvas position and visualization operations

use crate::db::Database;
use crate::models::{Atom, AtomPosition, AtomWithEmbedding, AtomWithTags};
use chrono::Utc;
use tauri::State;

use super::helpers::{get_average_embedding, get_tags_for_atom};

/// Get all stored atom positions from the database
#[tauri::command]
pub fn get_atom_positions(db: State<Database>) -> Result<Vec<AtomPosition>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT atom_id, x, y FROM atom_positions")
        .map_err(|e| e.to_string())?;

    let positions = stmt
        .query_map([], |row| {
            Ok(AtomPosition {
                atom_id: row.get(0)?,
                x: row.get(1)?,
                y: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(positions)
}

/// Bulk save/update positions after simulation completes
#[tauri::command]
pub fn save_atom_positions(
    db: State<Database>,
    positions: Vec<AtomPosition>,
) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();

    for pos in positions {
        conn.execute(
            "INSERT OR REPLACE INTO atom_positions (atom_id, x, y, updated_at) VALUES (?1, ?2, ?3, ?4)",
            (&pos.atom_id, &pos.x, &pos.y, &now),
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Get atoms with their average embedding vector for similarity calculations
#[tauri::command]
pub fn get_atoms_with_embeddings(db: State<Database>) -> Result<Vec<AtomWithEmbedding>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // First get all atoms with tags
    let mut stmt = conn
        .prepare(
            "SELECT id, content, source_url, created_at, updated_at, COALESCE(embedding_status, 'pending'), COALESCE(tagging_status, 'pending') FROM atoms ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let atoms: Vec<Atom> = stmt
        .query_map([], |row| {
            Ok(Atom {
                id: row.get(0)?,
                content: row.get(1)?,
                source_url: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
                embedding_status: row.get(5)?,
                tagging_status: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for atom in atoms {
        let tags = get_tags_for_atom(&conn, &atom.id)?;

        // Get average embedding for this atom
        let embedding = get_average_embedding(&conn, &atom.id)?;

        result.push(AtomWithEmbedding {
            atom: AtomWithTags { atom, tags },
            embedding,
        });
    }

    Ok(result)
}
