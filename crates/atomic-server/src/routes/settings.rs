//! Settings routes

use crate::error::blocking_ok;
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::Deserialize;

pub async fn get_settings(state: web::Data<AppState>) -> HttpResponse {
    let core = state.core.clone();
    blocking_ok(move || core.get_settings()).await
}

#[derive(Deserialize)]
pub struct SetSettingBody {
    pub value: String,
}

pub async fn set_setting(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<SetSettingBody>,
) -> HttpResponse {
    let key = path.into_inner();
    let value = body.into_inner().value;

    // Handle dimension-affecting settings via set_setting_with_reembed (avoids deadlock)
    let dimension_keys = ["provider", "embedding_model", "ollama_embedding_model"];
    if dimension_keys.contains(&key.as_str()) {
        let core = state.core.clone();
        let on_event = crate::event_bridge::embedding_event_callback(state.event_tx.clone());
        match web::block(move || {
            core.set_setting_with_reembed(&key, &value, on_event)
        }).await {
            Ok(Ok((changed, count))) => HttpResponse::Ok().json(serde_json::json!({
                "dimension_changed": changed,
                "pending_reembed_count": count,
            })),
            Ok(Err(e)) => crate::error::error_response(e),
            Err(e) => HttpResponse::InternalServerError()
                .json(serde_json::json!({"error": e.to_string()})),
        }
    } else {
        let core = state.core.clone();
        blocking_ok(move || core.set_setting(&key, &value)).await
    }
}

#[derive(Deserialize)]
pub struct TestOpenRouterBody {
    pub api_key: String,
}

pub async fn test_openrouter_connection(
    body: web::Json<TestOpenRouterBody>,
) -> HttpResponse {
    let client = reqwest::Client::new();

    let response = client
        .post("https://openrouter.ai/api/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", body.api_key))
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "model": "anthropic/claude-haiku-4.5",
            "messages": [{"role": "user", "content": "Hi"}],
            "max_tokens": 5
        }))
        .send()
        .await;

    match response {
        Ok(resp) if resp.status().is_success() => {
            HttpResponse::Ok().json(serde_json::json!({"success": true}))
        }
        Ok(resp) => {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            HttpResponse::BadRequest().json(serde_json::json!({
                "error": format!("API error ({}): {}", status, body)
            }))
        }
        Err(e) => HttpResponse::BadGateway().json(serde_json::json!({
            "error": format!("Network error: {}", e)
        })),
    }
}

pub async fn get_available_llm_models(state: web::Data<AppState>) -> HttpResponse {
    use atomic_core::providers::models::{
        fetch_and_return_capabilities, get_cached_capabilities_sync, save_capabilities_cache,
    };

    let db = state.core.database();

    // Check cache first
    let (cached, is_stale) = {
        let conn = match db.conn.lock() {
            Ok(c) => c,
            Err(e) => {
                return HttpResponse::InternalServerError()
                    .json(serde_json::json!({"error": e.to_string()}));
            }
        };
        match get_cached_capabilities_sync(&conn) {
            Ok(Some(cache)) => (Some(cache.clone()), cache.is_stale()),
            Ok(None) => (None, true),
            Err(_) => (None, true),
        }
    };

    if let Some(ref cache) = cached {
        if !is_stale {
            return HttpResponse::Ok().json(cache.get_models_with_structured_outputs());
        }
    }

    // Fetch fresh
    let client = reqwest::Client::new();
    match fetch_and_return_capabilities(&client).await {
        Ok(fresh_cache) => {
            if let Ok(conn) = db.new_connection() {
                let _ = save_capabilities_cache(&conn, &fresh_cache);
            }
            HttpResponse::Ok().json(fresh_cache.get_models_with_structured_outputs())
        }
        Err(e) => {
            if let Some(cache) = cached {
                HttpResponse::Ok().json(cache.get_models_with_structured_outputs())
            } else {
                HttpResponse::BadGateway()
                    .json(serde_json::json!({"error": format!("Failed to fetch models: {}", e)}))
            }
        }
    }
}
