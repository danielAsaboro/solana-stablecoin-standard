use axum::{extract::Json, http::StatusCode, routing::post, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct WebhookReg { pub url: String, pub events: Vec<String> }

#[derive(Serialize)]
pub struct WebhookResp { pub id: String, pub url: String, pub events: Vec<String>, pub status: String }

async fn register(Json(req): Json<WebhookReg>) -> (StatusCode, Json<WebhookResp>) {
    let id = Uuid::new_v4().to_string();
    (StatusCode::CREATED, Json(WebhookResp { id, url: req.url, events: req.events, status: "active".into() }))
}

pub fn router() -> Router { Router::new().route("/webhooks", post(register)) }
