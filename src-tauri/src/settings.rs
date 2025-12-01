use rusqlite::Connection;
use std::collections::HashMap;

/// Default Ollama host URL
pub const DEFAULT_OLLAMA_HOST: &str = "http://127.0.0.1:11434";

/// Default settings with their values
pub const DEFAULT_SETTINGS: &[(&str, &str)] = &[
    ("provider", "openrouter"),
    ("ollama_host", DEFAULT_OLLAMA_HOST),
    ("ollama_embedding_model", "nomic-embed-text"),
    ("ollama_llm_model", "llama3.2"),
    ("embedding_model", "openai/text-embedding-3-small"),
    ("tagging_model", "openai/gpt-4o-mini"),
    ("wiki_model", "anthropic/claude-sonnet-4.5"),
    ("chat_model", "anthropic/claude-sonnet-4.5"),
    ("auto_tagging_enabled", "true"),
];

/// Migrate settings - add any missing default settings
pub fn migrate_settings(conn: &Connection) -> Result<(), String> {
    for (key, default_value) in DEFAULT_SETTINGS {
        // Only set if the key doesn't exist
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM settings WHERE key = ?1",
                [key],
                |_| Ok(true),
            )
            .unwrap_or(false);

        if !exists {
            set_setting(conn, key, default_value)?;
        }
    }
    Ok(())
}

/// Get a setting with a default fallback
pub fn get_setting_or_default(conn: &Connection, key: &str) -> String {
    get_setting(conn, key).unwrap_or_else(|_| {
        DEFAULT_SETTINGS
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.to_string())
            .unwrap_or_default()
    })
}

/// Get all settings as a HashMap
pub fn get_all_settings(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM settings")
        .map_err(|e| format!("Failed to prepare settings query: {}", e))?;

    let settings = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| format!("Failed to query settings: {}", e))?
        .collect::<Result<HashMap<_, _>, _>>()
        .map_err(|e| format!("Failed to collect settings: {}", e))?;

    Ok(settings)
}

/// Get a single setting by key
pub fn get_setting(conn: &Connection, key: &str) -> Result<String, String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .map_err(|e| format!("Failed to get setting '{}': {}", key, e))
}

/// Set a setting (upsert)
pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [key, value],
    )
    .map_err(|e| format!("Failed to set setting: {}", e))?;

    Ok(())
}

