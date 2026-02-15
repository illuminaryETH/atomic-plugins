//! Import routes

use crate::event_bridge::embedding_event_callback;
use crate::state::{AppState, ServerEvent};
use actix_web::{web, HttpResponse};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ImportObsidianRequest {
    pub vault_path: String,
    pub max_notes: Option<i32>,
}

pub async fn import_obsidian_vault(
    state: web::Data<AppState>,
    body: web::Json<ImportObsidianRequest>,
) -> HttpResponse {
    let on_event = embedding_event_callback(state.event_tx.clone());
    let tx = state.event_tx.clone();
    let on_progress = move |progress: atomic_core::ImportProgress| {
        let _ = tx.send(ServerEvent::ImportProgress {
            current: progress.current,
            total: progress.total,
            current_file: progress.current_file,
            status: progress.status,
        });
    };

    match state.core.import_obsidian_vault(
        &body.vault_path,
        body.max_notes,
        on_event,
        on_progress,
    ) {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => crate::error::error_response(e),
    }
}
