//! Utility commands (database verification, tag compaction)

use crate::compaction;
use crate::db::Database;
use crate::providers::{
    fetch_and_return_capabilities, get_cached_capabilities_sync, save_capabilities_cache,
    ProviderConfig, ProviderType,
};
use crate::settings;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub fn check_sqlite_vec(db: State<Database>) -> Result<String, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let version: String = conn
        .query_row("SELECT vec_version()", [], |row| row.get(0))
        .map_err(|e| format!("sqlite-vec not loaded: {}", e))?;

    Ok(version)
}

#[tauri::command]
pub async fn compact_tags(
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<compaction::CompactionResult, String> {
    let _ = app_handle.emit("tags-compaction-start", serde_json::json!({}));

    let mut result = compaction::CompactionResult {
        tags_merged: 0,
        atoms_retagged: 0,
    };

    let (provider_config, model) = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        let settings_map = settings::get_all_settings(&conn)?;
        let provider_config = ProviderConfig::from_settings(&settings_map);

        match provider_config.provider_type {
            ProviderType::OpenRouter => {
                if provider_config.openrouter_api_key.is_none() {
                    let _ = app_handle.emit(
                        "tags-compaction-complete",
                        serde_json::json!({"success": false, "error": "OpenRouter API key not configured"}),
                    );
                    return Err(
                        "OpenRouter API key not configured. Please set it in Settings.".to_string(),
                    );
                }
            }
            ProviderType::Ollama => {
                if provider_config.ollama_host.is_empty() {
                    let _ = app_handle.emit(
                        "tags-compaction-complete",
                        serde_json::json!({"success": false, "error": "Ollama host not configured"}),
                    );
                    return Err(
                        "Ollama host not configured. Please set it in Settings.".to_string(),
                    );
                }
            }
        }

        let model = match provider_config.provider_type {
            ProviderType::Ollama => provider_config.llm_model().to_string(),
            ProviderType::OpenRouter => settings_map
                .get("tagging_model")
                .cloned()
                .unwrap_or_else(|| "openai/gpt-4o-mini".to_string()),
        };

        (provider_config, model)
    };

    let supported_params: Option<Vec<String>> =
        if provider_config.provider_type == ProviderType::OpenRouter {
            let client = reqwest::Client::new();

            let (cached, is_stale) = {
                let conn = db.conn.lock().map_err(|e| e.to_string())?;
                match get_cached_capabilities_sync(&conn) {
                    Ok(Some(cache)) => {
                        let stale = cache.is_stale();
                        (Some(cache), stale)
                    }
                    Ok(None) => (None, true),
                    Err(_) => (None, true),
                }
            };

            let capabilities = if is_stale {
                match fetch_and_return_capabilities(&client).await {
                    Ok(fresh_cache) => {
                        if let Ok(conn) = db.new_connection() {
                            let _ = save_capabilities_cache(&conn, &fresh_cache);
                        }
                        fresh_cache
                    }
                    Err(_) => cached.unwrap_or_default(),
                }
            } else {
                cached.unwrap_or_default()
            };

            capabilities.get_supported_params(&model).cloned()
        } else {
            None
        };

    eprintln!("=== Tag Merging ===");

    let all_tags = {
        let conn = db.conn.lock().map_err(|e| e.to_string())?;
        compaction::read_all_tags(&conn)?
    };

    if all_tags != "(no existing tags)" {
        match compaction::fetch_merge_suggestions(
            &provider_config,
            &all_tags,
            &model,
            supported_params,
        )
        .await
        {
            Ok(merge_suggestions) => {
                eprintln!(
                    "Received {} merge suggestions",
                    merge_suggestions.merges.len()
                );

                let (merged, retagged, errors) = {
                    let conn = db.conn.lock().map_err(|e| e.to_string())?;
                    compaction::apply_merge_operations(&conn, &merge_suggestions.merges)
                };

                result.tags_merged = merged;
                result.atoms_retagged = retagged;
                for err in errors {
                    eprintln!("{}", err);
                }
            }
            Err(e) => {
                eprintln!("Merge phase failed: {}", e);
            }
        }
    } else {
        eprintln!("No tags to merge");
    }

    eprintln!(
        "=== Compaction Complete: {} merged, {} atoms retagged ===",
        result.tags_merged, result.atoms_retagged
    );

    let _ = app_handle.emit(
        "tags-compaction-complete",
        serde_json::json!({
            "success": true,
            "tags_merged": result.tags_merged,
            "atoms_retagged": result.atoms_retagged
        }),
    );

    Ok(result)
}
