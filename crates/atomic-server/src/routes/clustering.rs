//! Clustering routes

use crate::error::blocking_ok;
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct ComputeClustersBody {
    pub min_similarity: Option<f32>,
    pub min_cluster_size: Option<i32>,
}

pub async fn compute_clusters(
    state: web::Data<AppState>,
    body: web::Json<ComputeClustersBody>,
) -> HttpResponse {
    let min_similarity = body.min_similarity.unwrap_or(0.6);
    let min_cluster_size = body.min_cluster_size.unwrap_or(2);
    let core = state.core.clone();
    match web::block(move || {
        let clusters = core.compute_clusters(min_similarity, min_cluster_size)?;
        core.save_clusters(&clusters)?;
        Ok::<_, atomic_core::AtomicCoreError>(clusters)
    }).await {
        Ok(Ok(clusters)) => HttpResponse::Ok().json(clusters),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

pub async fn get_clusters(state: web::Data<AppState>) -> HttpResponse {
    let core = state.core.clone();
    blocking_ok(move || core.get_clusters()).await
}

#[derive(Deserialize)]
pub struct ConnectionCountsQuery {
    pub min_similarity: Option<f32>,
}

pub async fn get_connection_counts(
    state: web::Data<AppState>,
    query: web::Query<ConnectionCountsQuery>,
) -> HttpResponse {
    let min_similarity = query.min_similarity.unwrap_or(0.5);
    let core = state.core.clone();
    blocking_ok(move || core.get_connection_counts(min_similarity)).await
}
