pub mod admin;
pub mod auth;
pub mod checkout;
pub mod instances;
pub mod webhooks;

use actix_web::web;

pub fn configure_public_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/api/checkout", web::post().to(checkout::create_checkout))
        .route(
            "/api/checkout/check-subdomain",
            web::get().to(checkout::check_subdomain),
        )
        .route(
            "/api/checkout/session",
            web::get().to(checkout::exchange_session),
        )
        .route("/api/stripe/webhook", web::post().to(webhooks::handle_webhook))
        .route("/api/auth/send", web::post().to(auth::send_magic_link))
        .route("/api/auth/verify", web::get().to(auth::verify_magic_link));
}

pub fn configure_instance_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/status", web::get().to(instances::get_status))
        .route("/start", web::post().to(instances::start))
        .route("/stop", web::post().to(instances::stop))
        .route("/restart", web::post().to(instances::restart))
        .route("/portal", web::post().to(instances::billing_portal));
}

pub fn configure_admin_routes(cfg: &mut web::ServiceConfig) {
    cfg.route("/instances", web::get().to(admin::list_instances))
        .route("/stats", web::get().to(admin::stats))
        .route("/rollout", web::post().to(admin::trigger_rollout));
}
