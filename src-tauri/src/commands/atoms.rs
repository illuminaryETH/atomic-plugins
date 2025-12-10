//! Atom CRUD operations

use crate::db::{Database, SharedDatabase};
use crate::embedding::spawn_embedding_task_single;
use crate::models::{Atom, AtomWithTags, CreateAtomRequest};
use chrono::Utc;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

use super::helpers::get_tags_for_atom;

#[tauri::command]
pub fn get_all_atoms(db: State<Database>) -> Result<Vec<AtomWithTags>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

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
        result.push(AtomWithTags { atom, tags });
    }

    Ok(result)
}

#[tauri::command]
pub fn get_atom_by_id(db: State<Database>, id: String) -> Result<Option<AtomWithTags>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let atom_result = conn.query_row(
        "SELECT id, content, source_url, created_at, updated_at, COALESCE(embedding_status, 'pending'), COALESCE(tagging_status, 'pending') FROM atoms WHERE id = ?1",
        [&id],
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
    );

    match atom_result {
        Ok(atom) => {
            let tags = get_tags_for_atom(&conn, &id)?;
            Ok(Some(AtomWithTags { atom, tags }))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Public function for creating an atom (used by both Tauri commands and HTTP API)
pub fn create_atom_impl(
    conn: &rusqlite::Connection,
    app_handle: tauri::AppHandle,
    shared_db: SharedDatabase,
    request: CreateAtomRequest,
) -> Result<AtomWithTags, String> {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    let embedding_status = "pending";

    conn.execute(
        "INSERT INTO atoms (id, content, source_url, created_at, updated_at, embedding_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        (&id, &request.content, &request.source_url, &now, &now, &embedding_status),
    )
    .map_err(|e| e.to_string())?;

    // Add tags
    for tag_id in &request.tag_ids {
        conn.execute(
            "INSERT INTO atom_tags (atom_id, tag_id) VALUES (?1, ?2)",
            (&id, tag_id),
        )
        .map_err(|e| e.to_string())?;
    }

    let atom = Atom {
        id: id.clone(),
        content: request.content.clone(),
        source_url: request.source_url,
        created_at: now.clone(),
        updated_at: now,
        embedding_status: embedding_status.to_string(),
        tagging_status: "pending".to_string(),
    };

    let tags = get_tags_for_atom(conn, &id)?;

    // Spawn embedding task (non-blocking)
    spawn_embedding_task_single(app_handle, shared_db, id, request.content);

    Ok(AtomWithTags { atom, tags })
}

#[tauri::command]
pub fn create_atom(
    app_handle: tauri::AppHandle,
    db: State<Database>,
    shared_db: State<SharedDatabase>,
    content: String,
    source_url: Option<String>,
    tag_ids: Vec<String>,
) -> Result<AtomWithTags, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let request = CreateAtomRequest {
        content,
        source_url,
        tag_ids,
    };

    let result = create_atom_impl(&conn, app_handle, Arc::clone(&shared_db), request)?;

    // Drop the connection lock
    drop(conn);

    Ok(result)
}

#[tauri::command]
pub fn update_atom(
    app_handle: tauri::AppHandle,
    db: State<Database>,
    shared_db: State<SharedDatabase>,
    id: String,
    content: String,
    source_url: Option<String>,
    tag_ids: Vec<String>,
) -> Result<AtomWithTags, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let now = Utc::now().to_rfc3339();
    let embedding_status = "pending"; // Reset to pending when content changes

    conn.execute(
        "UPDATE atoms SET content = ?1, source_url = ?2, updated_at = ?3, embedding_status = ?4 WHERE id = ?5",
        (&content, &source_url, &now, &embedding_status, &id),
    )
    .map_err(|e| e.to_string())?;

    // Remove existing tags and add new ones
    conn.execute("DELETE FROM atom_tags WHERE atom_id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    for tag_id in &tag_ids {
        conn.execute(
            "INSERT INTO atom_tags (atom_id, tag_id) VALUES (?1, ?2)",
            (&id, tag_id),
        )
        .map_err(|e| e.to_string())?;
    }

    // Get the updated atom
    let atom: Atom = conn
        .query_row(
            "SELECT id, content, source_url, created_at, updated_at, COALESCE(embedding_status, 'pending'), COALESCE(tagging_status, 'pending') FROM atoms WHERE id = ?1",
            [&id],
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
        .map_err(|e| e.to_string())?;

    let tags = get_tags_for_atom(&conn, &id)?;

    // Drop the connection lock before spawning the embedding task
    drop(conn);

    // Spawn embedding task (non-blocking)
    spawn_embedding_task_single(app_handle, Arc::clone(&shared_db), id, content);

    Ok(AtomWithTags { atom, tags })
}

#[tauri::command]
pub fn delete_atom(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM atoms WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}
