//! Database management routes

use crate::error::ApiErrorResponse;
use crate::state::AppState;
use actix_web::{web, HttpResponse};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[utoipa::path(get, path = "/api/databases", responses((status = 200, description = "List of databases with active ID")), tag = "databases")]
pub async fn list_databases(state: web::Data<AppState>) -> HttpResponse {
    match state.manager.list_databases() {
        Ok((databases, active_id)) => {
            HttpResponse::Ok().json(serde_json::json!({
                "databases": databases,
                "active_id": active_id,
            }))
        }
        Err(e) => crate::error::error_response(e),
    }
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct CreateDatabaseBody {
    /// Name for the new database
    pub name: String,
}

#[utoipa::path(post, path = "/api/databases", request_body = CreateDatabaseBody, responses((status = 201, description = "Database created", body = atomic_core::DatabaseInfo)), tag = "databases")]
pub async fn create_database(
    state: web::Data<AppState>,
    body: web::Json<CreateDatabaseBody>,
) -> HttpResponse {
    let name = body.into_inner().name;
    match state.manager.create_database(&name) {
        Ok(info) => HttpResponse::Created().json(info),
        Err(e) => crate::error::error_response(e),
    }
}

#[derive(Deserialize, Serialize, ToSchema)]
pub struct RenameDatabaseBody {
    /// New name for the database
    pub name: String,
}

#[utoipa::path(put, path = "/api/databases/{id}", params(("id" = String, Path, description = "Database ID")), request_body = RenameDatabaseBody, responses((status = 200, description = "Database renamed"), (status = 404, description = "Database not found", body = ApiErrorResponse)), tag = "databases")]
pub async fn rename_database(
    state: web::Data<AppState>,
    path: web::Path<String>,
    body: web::Json<RenameDatabaseBody>,
) -> HttpResponse {
    let id = path.into_inner();
    let name = body.into_inner().name;
    match state.manager.rename_database(&id, &name) {
        Ok(()) => HttpResponse::Ok().json(serde_json::json!({"renamed": true})),
        Err(e) => crate::error::error_response(e),
    }
}

#[utoipa::path(delete, path = "/api/databases/{id}", params(("id" = String, Path, description = "Database ID")), responses((status = 200, description = "Database deleted"), (status = 400, description = "Cannot delete default database", body = ApiErrorResponse)), tag = "databases")]
pub async fn delete_database(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let id = path.into_inner();
    match state.manager.delete_database(&id) {
        Ok(()) => HttpResponse::Ok().json(serde_json::json!({"deleted": true})),
        Err(e) => crate::error::error_response(e),
    }
}

#[utoipa::path(put, path = "/api/databases/{id}/activate", params(("id" = String, Path, description = "Database ID")), responses((status = 200, description = "Database activated")), tag = "databases")]
pub async fn activate_database(
    state: web::Data<AppState>,
    path: web::Path<String>,
) -> HttpResponse {
    let id = path.into_inner();
    match state.manager.set_active(&id) {
        Ok(()) => HttpResponse::Ok().json(serde_json::json!({"activated": true})),
        Err(e) => crate::error::error_response(e),
    }
}
