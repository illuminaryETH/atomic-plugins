//! Search routes

use crate::db_extractor::Db;
use crate::error::{blocking_ok, ok_or_error, ApiErrorResponse};
use actix_web::{web, HttpResponse};
use atomic_core::{SearchMode, SearchOptions, SemanticSearchResult, SimilarAtomResult};
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Deserialize, Serialize, ToSchema)]
pub struct SearchRequest {
    /// Search query text
    pub query: String,
    /// Search mode: "keyword", "semantic", or "hybrid"
    pub mode: String,
    /// Max results (default: 20)
    pub limit: Option<i32>,
    /// Minimum similarity threshold
    pub threshold: Option<f32>,
}

#[utoipa::path(
    post,
    path = "/api/search",
    request_body = SearchRequest,
    responses(
        (status = 200, description = "Search results", body = Vec<SemanticSearchResult>),
        (status = 400, description = "Invalid search mode", body = ApiErrorResponse),
    ),
    tag = "search",
)]
pub async fn search(db: Db, body: web::Json<SearchRequest>) -> HttpResponse {
    let req = body.into_inner();
    let mode = match req.mode.as_str() {
        "keyword" => SearchMode::Keyword,
        "semantic" => SearchMode::Semantic,
        "hybrid" => SearchMode::Hybrid,
        _ => {
            return HttpResponse::BadRequest().json(serde_json::json!({
                "error": "Invalid search mode. Use 'keyword', 'semantic', or 'hybrid'."
            }));
        }
    };

    let mut options = SearchOptions::new(req.query, mode, req.limit.unwrap_or(20));
    if let Some(threshold) = req.threshold {
        options = options.with_threshold(threshold);
    }

    let result = db.0.search(options).await;
    ok_or_error(result)
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct FindSimilarQuery {
    /// Max results (default: 10)
    pub limit: Option<i32>,
    /// Minimum similarity threshold (default: 0.7)
    pub threshold: Option<f32>,
}

#[utoipa::path(
    get,
    path = "/api/atoms/{id}/similar",
    params(
        ("id" = String, Path, description = "Atom ID"),
        FindSimilarQuery,
    ),
    responses(
        (status = 200, description = "Similar atoms", body = Vec<SimilarAtomResult>),
    ),
    tag = "search",
)]
pub async fn find_similar(
    db: Db,
    path: web::Path<String>,
    query: web::Query<FindSimilarQuery>,
) -> HttpResponse {
    let atom_id = path.into_inner();
    let limit = query.limit.unwrap_or(10);
    let threshold = query.threshold.unwrap_or(0.7);
    let core = db.0;
    blocking_ok(move || core.find_similar(&atom_id, limit, threshold)).await
}
