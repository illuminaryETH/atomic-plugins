//! Semantic graph routes

use crate::error::blocking_ok;
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct EdgesQuery {
    pub min_similarity: Option<f32>,
}

pub async fn get_semantic_edges(
    state: web::Data<AppState>,
    query: web::Query<EdgesQuery>,
) -> HttpResponse {
    let min_similarity = query.min_similarity.unwrap_or(0.5);
    let core = state.core.clone();
    blocking_ok(move || core.get_semantic_edges(min_similarity)).await
}

#[derive(Deserialize)]
pub struct NeighborhoodQuery {
    pub depth: Option<i32>,
    pub min_similarity: Option<f32>,
}

pub async fn get_atom_neighborhood(
    state: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<NeighborhoodQuery>,
) -> HttpResponse {
    let atom_id = path.into_inner();
    let depth = query.depth.unwrap_or(1);
    let min_similarity = query.min_similarity.unwrap_or(0.5);
    let core = state.core.clone();
    blocking_ok(move || core.get_atom_neighborhood(&atom_id, depth, min_similarity)).await
}

pub async fn rebuild_semantic_edges(state: web::Data<AppState>) -> HttpResponse {
    let core = state.core.clone();
    blocking_ok(move || core.rebuild_semantic_edges()).await
}
