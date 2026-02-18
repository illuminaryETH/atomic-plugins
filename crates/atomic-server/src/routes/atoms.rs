//! Atom and Tag CRUD routes

use crate::error::{blocking_ok, ok_or_error};
use crate::event_bridge::embedding_event_callback;
use crate::state::{AppState, ServerEvent};
use actix_web::{web, HttpResponse};
use serde::Deserialize;

// ==================== Atoms ====================

#[derive(Deserialize)]
pub struct GetAtomsQuery {
    pub tag_id: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
    pub cursor: Option<String>,
    pub cursor_id: Option<String>,
}

pub async fn get_atoms(
    state: web::Data<AppState>,
    query: web::Query<GetAtomsQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);
    let tag_id = query.tag_id.clone();
    let cursor = query.cursor.clone();
    let cursor_id = query.cursor_id.clone();
    let core = state.core.clone();
    blocking_ok(move || {
        core.list_atoms(
            tag_id.as_deref(),
            limit,
            offset,
            cursor.as_deref(),
            cursor_id.as_deref(),
        )
    }).await
}

pub async fn get_atom(state: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let core = state.core.clone();
    match web::block(move || core.get_atom(&id)).await {
        Ok(Ok(Some(atom))) => HttpResponse::Ok().json(atom),
        Ok(Ok(None)) => HttpResponse::NotFound().json(serde_json::json!({"error": "Atom not found"})),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

#[derive(Deserialize)]
pub struct CreateAtomRequest {
    pub content: String,
    pub source_url: Option<String>,
    pub tag_ids: Vec<String>,
}

pub async fn create_atom(
    state: web::Data<AppState>,
    body: web::Json<CreateAtomRequest>,
) -> HttpResponse {
    let req = body.into_inner();
    let on_event = embedding_event_callback(state.event_tx.clone());
    let core = state.core.clone();
    let event_tx = state.event_tx.clone();
    match web::block(move || {
        core.create_atom(
            atomic_core::CreateAtomRequest {
                content: req.content,
                source_url: req.source_url,
                tag_ids: req.tag_ids,
            },
            on_event,
        )
    }).await {
        Ok(Ok(atom)) => {
            let _ = event_tx.send(ServerEvent::AtomCreated { atom: atom.clone() });
            HttpResponse::Created().json(atom)
        }
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

#[derive(Deserialize)]
pub struct UpdateAtomRequest {
    pub content: String,
    pub source_url: Option<String>,
    pub tag_ids: Vec<String>,
}

pub async fn update_atom(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<UpdateAtomRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    let req = body.into_inner();
    let on_event = embedding_event_callback(state.event_tx.clone());
    let core = state.core.clone();
    blocking_ok(move || {
        core.update_atom(
            &id,
            atomic_core::UpdateAtomRequest {
                content: req.content,
                source_url: req.source_url,
                tag_ids: req.tag_ids,
            },
            on_event,
        )
    }).await
}

pub async fn delete_atom(state: web::Data<AppState>, path: web::Path<String>) -> HttpResponse {
    let id = path.into_inner();
    let core = state.core.clone();
    blocking_ok(move || core.delete_atom(&id)).await
}

// ==================== Tags ====================

#[derive(Deserialize)]
pub struct GetTagsQuery {
    pub min_count: Option<i32>,
}

#[derive(Deserialize)]
pub struct GetTagChildrenQuery {
    pub min_count: Option<i32>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub async fn get_tags(
    state: web::Data<AppState>,
    query: web::Query<GetTagsQuery>,
) -> HttpResponse {
    let min_count = query.min_count.unwrap_or(2);
    let core = state.core.clone();
    blocking_ok(move || core.get_all_tags_filtered(min_count)).await
}

pub async fn get_tag_children(
    state: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<GetTagChildrenQuery>,
) -> HttpResponse {
    let parent_id = path.into_inner();
    let min_count = query.min_count.unwrap_or(0);
    let limit = query.limit.unwrap_or(100);
    let offset = query.offset.unwrap_or(0);
    let core = state.core.clone();
    blocking_ok(move || core.get_tag_children(&parent_id, min_count, limit, offset)).await
}

#[derive(Deserialize)]
pub struct CreateTagRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

pub async fn create_tag(
    state: web::Data<AppState>,
    body: web::Json<CreateTagRequest>,
) -> HttpResponse {
    let req = body.into_inner();
    let core = state.core.clone();
    match web::block(move || core.create_tag(&req.name, req.parent_id.as_deref())).await {
        Ok(Ok(tag)) => HttpResponse::Created().json(tag),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

#[derive(Deserialize)]
pub struct UpdateTagRequest {
    pub name: String,
    pub parent_id: Option<String>,
}

pub async fn update_tag(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<UpdateTagRequest>,
) -> HttpResponse {
    let id = path.into_inner();
    let req = body.into_inner();
    let core = state.core.clone();
    blocking_ok(move || core.update_tag(&id, &req.name, req.parent_id.as_deref())).await
}

pub async fn delete_tag(
    state: web::Data<AppState>,
    path: web::Path<String>,
    query: web::Query<std::collections::HashMap<String, String>>,
) -> HttpResponse {
    let id = path.into_inner();
    let recursive = query.get("recursive").map(|v| v == "true").unwrap_or(false);
    let core = state.core.clone();
    blocking_ok(move || core.delete_tag(&id, recursive)).await
}
