use actix_web::{web, App, HttpResponse, HttpServer, Responder};
use actix_cors::Cors;
use tauri::Emitter;
use crate::models::CreateAtomRequest;
use crate::commands;
use crate::db::SharedDatabase;

pub struct AppState {
    pub shared_db: SharedDatabase,
    pub app_handle: tauri::AppHandle,
}

// Health check endpoint
async fn health() -> impl Responder {
    HttpResponse::Ok().json(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

// Create atom endpoint (reuses existing command logic)
async fn create_atom(
    state: web::Data<AppState>,
    payload: web::Json<CreateAtomRequest>,
) -> impl Responder {
    // Get a connection from the shared database
    let conn = match state.shared_db.new_connection() {
        Ok(conn) => conn,
        Err(e) => {
            return HttpResponse::InternalServerError().json(serde_json::json!({
                "error": format!("Database connection error: {}", e)
            }));
        }
    };

    match commands::create_atom_impl(
        &conn,
        state.app_handle.clone(),
        state.shared_db.clone(),
        payload.into_inner(),
    ) {
        Ok(atom) => {
            // Emit event to frontend to trigger immediate UI refresh
            state.app_handle.emit("atom-created", &atom).ok();
            HttpResponse::Ok().json(atom)
        },
        Err(e) => HttpResponse::InternalServerError().json(serde_json::json!({
            "error": e.to_string()
        }))
    }
}

pub async fn start_server(
    shared_db: SharedDatabase,
    app_handle: tauri::AppHandle,
) -> std::io::Result<()> {
    let port = 44380; // Uncommon port, unlikely to conflict

    let app_state = web::Data::new(AppState {
        shared_db,
        app_handle,
    });

    println!("Starting HTTP server on http://127.0.0.1:{}", port);

    HttpServer::new(move || {
        // Allow extension to make requests
        let cors = Cors::permissive(); // Localhost only, so permissive is fine

        App::new()
            .wrap(cors)
            .app_data(app_state.clone())
            .route("/health", web::get().to(health))
            .route("/atoms", web::post().to(create_atom))
    })
    .bind(("127.0.0.1", port))?
    .run()
    .await
}
