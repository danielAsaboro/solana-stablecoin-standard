//! Webhook registration routes.
//!
//! Stub endpoint pending full WebhookService implementation.

use axum::{extract::Json, http::StatusCode, routing::post, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::AppState;

#[derive(Deserialize)]
pub struct WebhookReg {
    pub url: String,
    pub events: Vec<String>,
}

#[derive(Serialize)]
pub struct WebhookResp {
    pub id: String,
    pub url: String,
    pub events: Vec<String>,
    pub status: String,
}

async fn register(Json(req): Json<WebhookReg>) -> (StatusCode, Json<WebhookResp>) {
    let id = Uuid::new_v4().to_string();
    tracing::info!(webhook_id = %id, url = %req.url, "Webhook registered");
    (
        StatusCode::CREATED,
        Json(WebhookResp {
            id,
            url: req.url,
            events: req.events,
            status: "active".into(),
        }),
    )
}

pub fn router() -> Router<AppState> {
    Router::new().route("/webhooks", post(register))
}
