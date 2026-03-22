//! Feed CRUD and polling routes

use crate::db_extractor::Db;
use crate::error::{blocking_ok, ApiErrorResponse};
use crate::event_bridge::{embedding_event_callback, ingestion_event_callback};
use crate::state::AppState;
use actix_web::{web, HttpResponse};

#[utoipa::path(get, path = "/api/feeds", responses((status = 200, description = "All feeds", body = Vec<atomic_core::Feed>)), tag = "feeds")]
pub async fn list_feeds(db: Db) -> HttpResponse {
    let core = db.0;
    blocking_ok(move || core.list_feeds()).await
}

#[utoipa::path(get, path = "/api/feeds/{id}", params(("id" = String, Path, description = "Feed ID")), responses((status = 200, description = "Feed details", body = atomic_core::Feed), (status = 404, description = "Feed not found", body = ApiErrorResponse)), tag = "feeds")]
pub async fn get_feed(db: Db, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let core = db.0;
    blocking_ok(move || core.get_feed(&id)).await
}

#[utoipa::path(post, path = "/api/feeds", request_body = atomic_core::CreateFeedRequest, responses((status = 201, description = "Feed created", body = atomic_core::Feed)), tag = "feeds")]
pub async fn create_feed(
    state: web::Data<AppState>,
    db: Db,
    body: web::Json<atomic_core::CreateFeedRequest>,
) -> HttpResponse {
    let on_ingest = ingestion_event_callback(state.event_tx.clone());
    let on_embed = embedding_event_callback(state.event_tx.clone());

    match db.0.create_feed(body.into_inner(), on_ingest, on_embed).await {
        Ok(feed) => HttpResponse::Created().json(feed),
        Err(e) => crate::error::error_response(e),
    }
}

#[utoipa::path(put, path = "/api/feeds/{id}", params(("id" = String, Path, description = "Feed ID")), request_body = atomic_core::UpdateFeedRequest, responses((status = 200, description = "Feed updated", body = atomic_core::Feed)), tag = "feeds")]
pub async fn update_feed(
    db: Db,
    path: web::Path<String>,
    body: web::Json<atomic_core::UpdateFeedRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    let core = db.0;
    blocking_ok(move || core.update_feed(&id, body.into_inner())).await
}

#[utoipa::path(delete, path = "/api/feeds/{id}", params(("id" = String, Path, description = "Feed ID")), responses((status = 200, description = "Feed deleted")), tag = "feeds")]
pub async fn delete_feed(db: Db, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let core = db.0;
    blocking_ok(move || {
        core.delete_feed(&id)?;
        Ok(serde_json::json!({"deleted": true}))
    })
    .await
}

#[utoipa::path(post, path = "/api/feeds/{id}/poll", params(("id" = String, Path, description = "Feed ID")), responses((status = 200, description = "Poll results")), tag = "feeds")]
pub async fn poll_feed(state: web::Data<AppState>, db: Db, path: web::Path<String>) -> HttpResponse {
    let feed_id = path.into_inner();
    let on_ingest = ingestion_event_callback(state.event_tx.clone());
    let on_embed = embedding_event_callback(state.event_tx.clone());

    match db.0.poll_feed(&feed_id, on_ingest, on_embed).await {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => crate::error::error_response(e),
    }
}
