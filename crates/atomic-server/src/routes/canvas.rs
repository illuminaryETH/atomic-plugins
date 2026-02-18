//! Canvas position routes

use crate::error::blocking_ok;
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use atomic_core::AtomPosition;
use serde::Deserialize;

pub async fn get_positions(state: web::Data<AppState>) -> HttpResponse {
    let core = state.core.clone();
    blocking_ok(move || core.get_atom_positions()).await
}

pub async fn save_positions(
    state: web::Data<AppState>,
    body: web::Json<Vec<AtomPosition>>,
) -> HttpResponse {
    let positions = body.into_inner();
    let core = state.core.clone();
    match web::block(move || core.save_atom_positions(&positions)).await {
        Ok(Ok(())) => HttpResponse::Ok().json(serde_json::json!({"status": "ok"})),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

pub async fn get_atoms_with_embeddings(state: web::Data<AppState>) -> HttpResponse {
    let core = state.core.clone();
    blocking_ok(move || core.get_atoms_with_embeddings()).await
}

#[derive(Deserialize)]
pub struct CanvasLevelQuery {
    pub parent_id: Option<String>,
}

#[derive(Deserialize)]
pub struct CanvasLevelBody {
    pub children_hint: Option<Vec<String>>,
}

pub async fn get_canvas_level(
    state: web::Data<AppState>,
    query: web::Query<CanvasLevelQuery>,
    body: Option<web::Json<CanvasLevelBody>>,
) -> HttpResponse {
    let parent_id = query.parent_id.clone();
    let children_hint = body.and_then(|b| b.into_inner().children_hint);
    let core = state.core.clone();
    blocking_ok(move || core.get_canvas_level(parent_id.as_deref(), children_hint)).await
}
