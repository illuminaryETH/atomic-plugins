//! Canvas position routes

use crate::db_extractor::Db;
use crate::error::blocking_ok;
use actix_web::{web, HttpResponse};
use atomic_core::AtomPosition;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[utoipa::path(get, path = "/api/canvas/positions", responses((status = 200, description = "All atom positions", body = Vec<AtomPosition>)), tag = "canvas")]
pub async fn get_positions(db: Db) -> HttpResponse {
    let core = db.0;
    blocking_ok(move || core.get_atom_positions()).await
}

#[utoipa::path(put, path = "/api/canvas/positions", request_body = Vec<AtomPosition>, responses((status = 200, description = "Positions saved")), tag = "canvas")]
pub async fn save_positions(
    db: Db,
    body: web::Json<Vec<AtomPosition>>,
) -> HttpResponse {
    let positions = body.into_inner();
    let core = db.0;
    match web::block(move || core.save_atom_positions(&positions)).await {
        Ok(Ok(())) => HttpResponse::Ok().json(serde_json::json!({"status": "ok"})),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

#[utoipa::path(get, path = "/api/canvas/atoms-with-embeddings", responses((status = 200, description = "Atoms with embedding vectors", body = Vec<atomic_core::AtomWithEmbedding>)), tag = "canvas")]
pub async fn get_atoms_with_embeddings(db: Db) -> HttpResponse {
    let core = db.0;
    blocking_ok(move || core.get_atoms_with_embeddings()).await
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CanvasLevelQuery {
    /// Parent node ID (null for root level)
    pub parent_id: Option<String>,
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct CanvasLevelBody {
    /// Hint for which children to include
    pub children_hint: Option<Vec<String>>,
}

#[utoipa::path(post, path = "/api/canvas/level", params(CanvasLevelQuery), request_body(content = Option<CanvasLevelBody>), responses((status = 200, description = "Canvas level data", body = atomic_core::CanvasLevel)), tag = "canvas")]
pub async fn get_canvas_level(
    db: Db,
    query: web::Query<CanvasLevelQuery>,
    body: Option<web::Json<CanvasLevelBody>>,
) -> HttpResponse {
    let parent_id = query.parent_id.clone();
    let children_hint = body.and_then(|b| b.into_inner().children_hint);
    let core = db.0;
    blocking_ok(move || core.get_canvas_level(parent_id.as_deref(), children_hint)).await
}
