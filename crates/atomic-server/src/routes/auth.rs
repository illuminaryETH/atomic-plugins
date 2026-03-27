//! Token management endpoints

use crate::error::ApiErrorResponse;
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Deserialize, Serialize, ToSchema)]
pub struct CreateTokenBody {
    /// Name for the new token
    pub name: String,
}

#[utoipa::path(post, path = "/api/auth/tokens", request_body = CreateTokenBody, responses((status = 201, description = "Token created (includes raw token — save it, won't be shown again)")), tag = "auth")]
pub async fn create_token(
    state: web::Data<AppState>,
    body: web::Json<CreateTokenBody>,
) -> HttpResponse {
    let name = body.into_inner().name;
    let core = match state.manager.active_core() {
        Ok(c) => c,
        Err(e) => return crate::error::error_response(e),
    };
    match web::block(move || core.create_api_token(&name)).await {
        Ok(Ok((info, raw_token))) => HttpResponse::Created().json(serde_json::json!({
            "id": info.id,
            "name": info.name,
            "token": raw_token,
            "prefix": info.token_prefix,
            "created_at": info.created_at,
        })),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

#[utoipa::path(get, path = "/api/auth/tokens", responses((status = 200, description = "List of API tokens (metadata only)", body = Vec<atomic_core::ApiTokenInfo>)), tag = "auth")]
pub async fn list_tokens(state: web::Data<AppState>) -> HttpResponse {
    let core = match state.manager.active_core() {
        Ok(c) => c,
        Err(e) => return crate::error::error_response(e),
    };
    match web::block(move || core.list_api_tokens()).await {
        Ok(Ok(tokens)) => HttpResponse::Ok().json(tokens),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}

#[utoipa::path(delete, path = "/api/auth/tokens/{id}", params(("id" = String, Path, description = "Token ID")), responses((status = 200, description = "Token revoked"), (status = 404, description = "Token not found", body = ApiErrorResponse)), tag = "auth")]
pub async fn revoke_token(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let token_id = path.into_inner();
    let core = match state.manager.active_core() {
        Ok(c) => c,
        Err(e) => return crate::error::error_response(e),
    };
    match web::block(move || core.revoke_api_token(&token_id)).await {
        Ok(Ok(())) => HttpResponse::Ok().json(serde_json::json!({"revoked": true})),
        Ok(Err(e)) => crate::error::error_response(e),
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({"error": e.to_string()})),
    }
}
