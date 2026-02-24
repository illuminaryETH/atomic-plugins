//! Feed CRUD and polling routes

use crate::error::blocking_ok;
use crate::event_bridge::{embedding_event_callback, ingestion_event_callback};
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct CreateFeedRequest {
    pub url: String,
    #[serde(default = "default_poll_interval")]
    pub poll_interval: i32,
    #[serde(default)]
    pub tag_ids: Vec<String>,
}

fn default_poll_interval() -> i32 {
    60
}

#[derive(Deserialize)]
pub struct UpdateFeedRequest {
    pub poll_interval: Option<i32>,
    pub is_paused: Option<bool>,
    pub tag_ids: Option<Vec<String>>,
}

pub async fn list_feeds(state: web::Data<AppState>) -> HttpResponse {
    let core = state.core.clone();
    blocking_ok(move || core.list_feeds()).await
}

pub async fn get_feed(state: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let core = state.core.clone();
    blocking_ok(move || core.get_feed(&id)).await
}

pub async fn create_feed(
    state: web::Data<AppState>,
    body: web::Json<CreateFeedRequest>,
) -> HttpResponse {
    let request = atomic_core::CreateFeedRequest {
        url: body.url.clone(),
        poll_interval: body.poll_interval,
        tag_ids: body.tag_ids.clone(),
    };

    let on_ingest = ingestion_event_callback(state.event_tx.clone());
    let on_embed = embedding_event_callback(state.event_tx.clone());

    match state.core.create_feed(request, on_ingest, on_embed).await {
        Ok(feed) => HttpResponse::Created().json(feed),
        Err(e) => crate::error::error_response(e),
    }
}

pub async fn update_feed(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<UpdateFeedRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    let request = atomic_core::UpdateFeedRequest {
        poll_interval: body.poll_interval,
        is_paused: body.is_paused,
        tag_ids: body.tag_ids.clone(),
    };

    let core = state.core.clone();
    blocking_ok(move || core.update_feed(&id, request)).await
}

pub async fn delete_feed(state: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let core = state.core.clone();
    blocking_ok(move || {
        core.delete_feed(&id)?;
        Ok(serde_json::json!({"deleted": true}))
    })
    .await
}

pub async fn poll_feed(state: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let feed_id = path.into_inner();
    let on_ingest = ingestion_event_callback(state.event_tx.clone());
    let on_embed = embedding_event_callback(state.event_tx.clone());

    match state.core.poll_feed(&feed_id, on_ingest, on_embed).await {
        Ok(result) => HttpResponse::Ok().json(result),
        Err(e) => crate::error::error_response(e),
    }
}
