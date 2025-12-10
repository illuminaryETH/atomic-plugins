//! Ollama-specific operations

use crate::db::Database;
use crate::providers::models::{
    fetch_ollama_models, get_ollama_embedding_models, get_ollama_llm_models,
    test_ollama_connection, OllamaModel,
};
use crate::providers::{AvailableModel, ProviderConfig, ProviderType};
use crate::settings;
use tauri::State;

/// Test connection to Ollama server
#[tauri::command]
pub async fn test_ollama(host: String) -> Result<bool, String> {
    test_ollama_connection(&host).await
}

/// Get all available Ollama models (with categorization)
#[tauri::command]
pub async fn get_ollama_models(host: String) -> Result<Vec<OllamaModel>, String> {
    fetch_ollama_models(&host).await
}

/// Get Ollama embedding models only
#[tauri::command]
pub async fn get_ollama_embedding_models_cmd(host: String) -> Result<Vec<AvailableModel>, String> {
    get_ollama_embedding_models(&host).await
}

/// Get Ollama LLM models only (non-embedding)
#[tauri::command]
pub async fn get_ollama_llm_models_cmd(host: String) -> Result<Vec<AvailableModel>, String> {
    get_ollama_llm_models(&host).await
}

/// Verify that a provider is properly configured
/// Returns true if the selected provider has all required settings
/// - OpenRouter: requires non-empty API key
/// - Ollama: requires host (has default, so just checks provider type for now)
#[tauri::command]
pub fn verify_provider_configured(db: State<Database>) -> Result<bool, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let settings = settings::get_all_settings(&conn)?;
    let config = ProviderConfig::from_settings(&settings);

    match config.provider_type {
        ProviderType::OpenRouter => {
            // Check if API key exists and is non-empty
            Ok(config.openrouter_api_key.is_some()
                && !config
                    .openrouter_api_key
                    .as_ref()
                    .map(|k| k.is_empty())
                    .unwrap_or(true))
        }
        ProviderType::Ollama => {
            // Check if host is configured (has default "http://localhost:11434")
            Ok(!config.ollama_host.is_empty())
        }
    }
}
