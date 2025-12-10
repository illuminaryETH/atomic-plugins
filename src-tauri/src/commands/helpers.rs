//! Shared helper functions used across command modules

use crate::models::Tag;

/// Helper function to get tags for an atom
pub fn get_tags_for_atom(conn: &rusqlite::Connection, atom_id: &str) -> Result<Vec<Tag>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT t.id, t.name, t.parent_id, t.created_at
             FROM tags t
             INNER JOIN atom_tags at ON t.id = at.tag_id
             WHERE at.atom_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let tags = stmt
        .query_map([atom_id], |row| {
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

    Ok(tags)
}

/// Helper function to calculate average embedding from all chunks of an atom
pub fn get_average_embedding(
    conn: &rusqlite::Connection,
    atom_id: &str,
) -> Result<Option<Vec<f32>>, String> {
    let mut stmt = conn
        .prepare("SELECT embedding FROM atom_chunks WHERE atom_id = ?1 AND embedding IS NOT NULL")
        .map_err(|e| e.to_string())?;

    let embeddings: Vec<Vec<u8>> = stmt
        .query_map([atom_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    if embeddings.is_empty() {
        return Ok(None);
    }

    // Convert blob embeddings to f32 vectors and average them
    // Each embedding is 384 dimensions * 4 bytes = 1536 bytes
    let dimension = 384;
    let mut avg_embedding = vec![0.0f32; dimension];
    let count = embeddings.len() as f32;

    for blob in &embeddings {
        if blob.len() != dimension * 4 {
            continue; // Skip malformed embeddings
        }

        for i in 0..dimension {
            let bytes: [u8; 4] = [
                blob[i * 4],
                blob[i * 4 + 1],
                blob[i * 4 + 2],
                blob[i * 4 + 3],
            ];
            avg_embedding[i] += f32::from_le_bytes(bytes);
        }
    }

    // Divide by count to get average
    for val in &mut avg_embedding {
        *val /= count;
    }

    Ok(Some(avg_embedding))
}

/// Helper function to get dominant tags for a cluster
pub fn get_dominant_tags_for_cluster(
    conn: &rusqlite::Connection,
    atom_ids: &[String],
) -> Result<Vec<String>, String> {
    if atom_ids.is_empty() {
        return Ok(vec![]);
    }

    let placeholders: Vec<String> = atom_ids.iter().map(|_| "?".to_string()).collect();
    let placeholders_str = placeholders.join(",");

    let sql = format!(
        "SELECT t.name, COUNT(*) as cnt
         FROM atom_tags at
         JOIN tags t ON at.tag_id = t.id
         WHERE at.atom_id IN ({})
         GROUP BY t.id
         ORDER BY cnt DESC
         LIMIT 3",
        placeholders_str
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<&dyn rusqlite::ToSql> = atom_ids
        .iter()
        .map(|s| s as &dyn rusqlite::ToSql)
        .collect();

    let tags: Vec<String> = stmt
        .query_map(params.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    Ok(tags)
}
