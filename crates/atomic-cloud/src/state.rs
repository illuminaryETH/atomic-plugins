//! Application state shared across all request handlers

use crate::clients::{fly::FlyClient, mailgun::MailgunClient, stripe::StripeClient};
use sqlx::PgPool;
use std::sync::Arc;

pub struct CloudState {
    pub db: PgPool,
    pub stripe: StripeClient,
    pub fly: Arc<FlyClient>,
    pub mailgun: MailgunClient,
    pub config: CloudConfig,
}

pub struct CloudConfig {
    pub stripe_price_id: String,
    pub stripe_webhook_secret: String,
    pub base_domain: String,
    pub atomic_image: String,
    pub fly_org: String,
    pub fly_region: String,
    pub admin_api_key: String,
    pub public_url: String,
}
