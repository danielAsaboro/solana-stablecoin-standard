use axum::{extract::Json, http::StatusCode, routing::post, Router};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Deserialize)]
pub struct MintRequest { pub recipient: String, pub amount: u64 }

#[derive(Deserialize)]
pub struct BurnRequest { pub from_account: String, pub amount: u64 }

#[derive(Serialize)]
pub struct OpResponse { pub id: String, pub status: String, pub message: String }

async fn mint_handler(Json(req): Json<MintRequest>) -> (StatusCode, Json<OpResponse>) {
    let id = Uuid::new_v4().to_string();
    tracing::info!("Mint request {}: {} to {}", id, req.amount, req.recipient);
    (StatusCode::ACCEPTED, Json(OpResponse { id, status: "pending".into(), message: format!("Mint of {} queued", req.amount) }))
}

async fn burn_handler(Json(req): Json<BurnRequest>) -> (StatusCode, Json<OpResponse>) {
    let id = Uuid::new_v4().to_string();
    tracing::info!("Burn request {}: {} from {}", id, req.amount, req.from_account);
    (StatusCode::ACCEPTED, Json(OpResponse { id, status: "pending".into(), message: format!("Burn of {} queued", req.amount) }))
}

pub fn router() -> Router {
    Router::new().route("/mint", post(mint_handler)).route("/burn", post(burn_handler))
}
