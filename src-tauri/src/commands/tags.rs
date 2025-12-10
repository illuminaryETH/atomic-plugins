//! Tag CRUD operations

use crate::db::Database;
use crate::models::{Atom, AtomWithTags, Tag, TagWithCount};
use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use super::helpers::get_tags_for_atom;

#[tauri::command]
pub fn get_all_tags(db: State<Database>) -> Result<Vec<TagWithCount>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get all tags
    let mut stmt = conn
        .prepare("SELECT id, name, parent_id, created_at FROM tags ORDER BY name")
        .map_err(|e| e.to_string())?;

    let all_tags: Vec<Tag> = stmt
        .query_map([], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                parent_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    // Helper function to get all descendant tag IDs recursively
    fn get_descendant_ids(tag_id: &str, all_tags: &[Tag]) -> Vec<String> {
        let mut result = vec![tag_id.to_string()];
        let children: Vec<&Tag> = all_tags
            .iter()
            .filter(|t| t.parent_id.as_deref() == Some(tag_id))
            .collect();
        for child in children {
            result.extend(get_descendant_ids(&child.id, all_tags));
        }
        result
    }

    // Build hierarchical structure with deduplicated counts
    fn build_tree(
        all_tags: &[Tag],
        parent_id: Option<&str>,
        conn: &rusqlite::Connection,
    ) -> Vec<TagWithCount> {
        all_tags
            .iter()
            .filter(|tag| tag.parent_id.as_deref() == parent_id)
            .map(|tag| {
                let children = build_tree(all_tags, Some(&tag.id), conn);

                // Get all descendant tag IDs including this tag
                let descendant_ids = get_descendant_ids(&tag.id, all_tags);

                // Count distinct atoms across this tag and all descendants
                let placeholders = descendant_ids
                    .iter()
                    .map(|_| "?")
                    .collect::<Vec<_>>()
                    .join(",");
                let query = format!(
                    "SELECT COUNT(DISTINCT atom_id) FROM atom_tags WHERE tag_id IN ({})",
                    placeholders
                );

                let atom_count: i32 = conn
                    .query_row(
                        &query,
                        rusqlite::params_from_iter(descendant_ids.iter()),
                        |row| row.get(0),
                    )
                    .unwrap_or(0);

                TagWithCount {
                    tag: tag.clone(),
                    atom_count,
                    children,
                }
            })
            .collect()
    }

    Ok(build_tree(&all_tags, None, &conn))
}

#[tauri::command]
pub fn create_tag(
    db: State<Database>,
    name: String,
    parent_id: Option<String>,
) -> Result<Tag, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    conn.execute(
        "INSERT INTO tags (id, name, parent_id, created_at) VALUES (?1, ?2, ?3, ?4)",
        (&id, &name, &parent_id, &now),
    )
    .map_err(|e| e.to_string())?;

    Ok(Tag {
        id,
        name,
        parent_id,
        created_at: now,
    })
}

#[tauri::command]
pub fn update_tag(
    db: State<Database>,
    id: String,
    name: String,
    parent_id: Option<String>,
) -> Result<Tag, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE tags SET name = ?1, parent_id = ?2 WHERE id = ?3",
        (&name, &parent_id, &id),
    )
    .map_err(|e| e.to_string())?;

    // Get the updated tag
    let tag: Tag = conn
        .query_row(
            "SELECT id, name, parent_id, created_at FROM tags WHERE id = ?1",
            [&id],
            |row| {
                Ok(Tag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    parent_id: row.get(2)?,
                    created_at: row.get(3)?,
                })
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(tag)
}

#[tauri::command]
pub fn delete_tag(db: State<Database>, id: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    conn.execute("DELETE FROM tags WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_atoms_by_tag(db: State<Database>, tag_id: String) -> Result<Vec<AtomWithTags>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // Get all descendant tag IDs (including the tag itself)
    let mut all_tag_ids = vec![tag_id.clone()];
    let mut to_process = vec![tag_id.clone()];

    while let Some(current_id) = to_process.pop() {
        let mut child_stmt = conn
            .prepare("SELECT id FROM tags WHERE parent_id = ?1")
            .map_err(|e| e.to_string())?;

        let children: Vec<String> = child_stmt
            .query_map([&current_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        for child_id in children {
            all_tag_ids.push(child_id.clone());
            to_process.push(child_id);
        }
    }

    // Query atoms with any of these tags (deduplicated)
    let placeholders = all_tag_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT DISTINCT a.id, a.content, a.source_url, a.created_at, a.updated_at, COALESCE(a.embedding_status, 'pending'), COALESCE(a.tagging_status, 'pending')
         FROM atoms a
         INNER JOIN atom_tags at ON a.id = at.atom_id
         WHERE at.tag_id IN ({})
         ORDER BY a.updated_at DESC",
        placeholders
    );

    let mut stmt = conn.prepare(&query).map_err(|e| e.to_string())?;

    let atoms: Vec<Atom> = stmt
        .query_map(rusqlite::params_from_iter(all_tag_ids.iter()), |row| {
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
