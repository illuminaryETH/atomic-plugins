//! Feed CRUD and polling routes

use crate::db_extractor::Db;
use crate::error::{blocking_ok, ApiErrorResponse};
use crate::event_bridge::{embedding_event_callback, ingestion_event_callback};
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, Serialize, ToSchema)]
pub struct CreateFeedRequest {
    /// Feed URL (RSS/Atom)
    pub url: String,
    /// Poll interval in minutes (default: 60)
    #[serde(default = "default_poll_interval")]
    pub poll_interval: i32,
    /// Tag IDs to assign to ingested items
    #[serde(default)]
    pub tag_ids: Vec<String>,
}

fn default_poll_interval() -> i32 {
    60
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct UpdateFeedRequest {
    /// Updated poll interval in minutes
    pub poll_interval: Option<i32>,
    /// Pause/unpause the feed
    pub is_paused: Option<bool>,
    /// Updated tag IDs
    pub tag_ids: Option<Vec<String>>,
}

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

#[utoipa::path(post, path = "/api/feeds", request_body = CreateFeedRequest, responses((status = 201, description = "Feed created", body = atomic_core::Feed)), tag = "feeds")]
pub async fn create_feed(
    state: web::Data<AppState>,
    db: Db,
    body: web::Json<CreateFeedRequest>,
) -> HttpResponse {
    let request = atomic_core::CreateFeedRequest {
        url: body.url.clone(),
        poll_interval: body.poll_interval,
        tag_ids: body.tag_ids.clone(),
    };

    let on_ingest = ingestion_event_callback(state.event_tx.clone());
    let on_embed = embedding_event_callback(state.event_tx.clone());

    match db.0.create_feed(request, on_ingest, on_embed).await {
        Ok(feed) => HttpResponse::Created().json(feed),
        Err(e) => crate::error::error_response(e),
    }
}

#[utoipa::path(put, path = "/api/feeds/{id}", params(("id" = String, Path, description = "Feed ID")), request_body = UpdateFeedRequest, responses((status = 200, description = "Feed updated", body = atomic_core::Feed)), tag = "feeds")]
pub async fn update_feed(
    db: Db,
    path: web::Path<String>,
    body: web::Json<UpdateFeedRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    let request = atomic_core::UpdateFeedRequest {
        poll_interval: body.poll_interval,
        is_paused: body.is_paused,
        tag_ids: body.tag_ids.clone(),
    };

    let core = db.0;
    blocking_ok(move || core.update_feed(&id, request)).await
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
