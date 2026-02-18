//! Chat / Conversation routes

use crate::error::blocking_ok;
use crate::event_bridge::chat_event_callback;
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::Deserialize;

#[derive(Deserialize)]
pub struct CreateConversationBody {
    pub tag_ids: Vec<String>,
    pub title: Option<String>,
}

pub async fn create_conversation(
    state: web::Data<AppState>,
    body: web::Json<CreateConversationBody>,
) -> HttpResponse {
    let req = body.into_inner();
    let core = state.core.clone();
    match web::block(move || core.create_conversation(&req.tag_ids, req.title.as_deref())).await {
        Ok(Ok(conv)) => HttpResponse::Created().json(conv),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

#[derive(Deserialize)]
pub struct GetConversationsQuery {
    pub filter_tag_id: Option<String>,
    pub limit: Option<i32>,
    pub offset: Option<i32>,
}

pub async fn get_conversations(
    state: web::Data<AppState>,
    query: web::Query<GetConversationsQuery>,
) -> HttpResponse {
    let limit = query.limit.unwrap_or(50);
    let offset = query.offset.unwrap_or(0);
    let filter_tag_id = query.filter_tag_id.clone();
    let core = state.core.clone();
    blocking_ok(move || core.get_conversations(filter_tag_id.as_deref(), limit, offset)).await
}

pub async fn get_conversation(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let id = path.into_inner();
    let core = state.core.clone();
    match web::block(move || core.get_conversation(&id)).await {
        Ok(Ok(Some(conv))) => HttpResponse::Ok().json(conv),
        Ok(Ok(None)) => {
            HttpResponse::NotFound().json(serde_json::json!({"error": "Conversation not found"}))
        }
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

#[derive(Deserialize)]
pub struct UpdateConversationBody {
    pub title: Option<String>,
    pub is_archived: Option<bool>,
}

pub async fn update_conversation(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<UpdateConversationBody>,
) -> HttpResponse {
    let id = path.into_inner();
    let req = body.into_inner();
    let core = state.core.clone();
    blocking_ok(move || core.update_conversation(&id, req.title.as_deref(), req.is_archived)).await
}

pub async fn delete_conversation(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let id = path.into_inner();
    let core = state.core.clone();
    blocking_ok(move || core.delete_conversation(&id)).await
}

#[derive(Deserialize)]
pub struct SetScopeBody {
    pub tag_ids: Vec<String>,
}

pub async fn set_conversation_scope(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<SetScopeBody>,
) -> HttpResponse {
    let id = path.into_inner();
    let tag_ids = body.into_inner().tag_ids;
    let core = state.core.clone();
    blocking_ok(move || core.set_conversation_scope(&id, &tag_ids)).await
}

#[derive(Deserialize)]
pub struct AddTagBody {
    pub tag_id: String,
}

pub async fn add_tag_to_scope(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<AddTagBody>,
) -> HttpResponse {
    let id = path.into_inner();
    let tag_id = body.into_inner().tag_id;
    let core = state.core.clone();
    blocking_ok(move || core.add_tag_to_scope(&id, &tag_id)).await
}

pub async fn remove_tag_from_scope(
    state: web::Data<AppState>,
    path: web::Path<(String, String)>,
) -> HttpResponse {
    let (id, tag_id) = path.into_inner();
    let core = state.core.clone();
    blocking_ok(move || core.remove_tag_from_scope(&id, &tag_id)).await
}

#[derive(Deserialize)]
pub struct SendMessageBody {
    pub content: String,
}

pub async fn send_chat_message(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<SendMessageBody>,
) -> HttpResponse {
    let conversation_id = path.into_inner();
    let content = body.into_inner().content;
    let on_event = chat_event_callback(state.event_tx.clone());

    match state
        .core
        .send_chat_message(&conversation_id, &content, on_event)
        .await
    {
        Ok(message) => HttpResponse::Ok().json(message),
        Err(e) => crate::error::error_response(e),
    }
}
