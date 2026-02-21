//! Compliance API routes — blacklist management and audit log.
//!
//! These endpoints are stubs pending full ComplianceService implementation.
//! They accept requests and return placeholder responses.

use axum::{
    extract::{Json, Path},
    http::StatusCode,
    routing::{delete, get, post},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::AppState;

#[derive(Deserialize)]
pub struct BlacklistRequest {
    pub address: String,
    pub reason: String,
}

#[derive(Serialize)]
pub struct BlacklistResponse {
    pub address: String,
    pub status: String,
    pub message: String,
}

#[derive(Serialize)]
pub struct BlacklistEntry {
    pub address: String,
    pub reason: String,
    pub blacklisted_at: String,
}

#[derive(Serialize)]
pub struct AuditEntry {
    pub action: String,
    pub timestamp: String,
    pub details: serde_json::Value,
}

async fn add_blacklist(
    Json(req): Json<BlacklistRequest>,
) -> (StatusCode, Json<BlacklistResponse>) {
    tracing::info!(address = %req.address, reason = %req.reason, "Blacklist add");
    (
        StatusCode::CREATED,
        Json(BlacklistResponse {
            address: req.address,
            status: "blacklisted".into(),
            message: format!("Added to blacklist: {}", req.reason),
        }),
    )
}

async fn remove_blacklist(Path(addr): Path<String>) -> (StatusCode, Json<BlacklistResponse>) {
    tracing::info!("Blacklist remove: {}", addr);
    (
        StatusCode::OK,
        Json(BlacklistResponse {
            address: addr,
            status: "removed".into(),
            message: "Removed from blacklist".into(),
        }),
    )
}

async fn get_blacklist() -> Json<Vec<BlacklistEntry>> {
    Json(vec![])
}

async fn get_audit() -> Json<Vec<AuditEntry>> {
    Json(vec![])
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/blacklist", post(add_blacklist).get(get_blacklist))
        .route("/blacklist/{addr}", delete(remove_blacklist))
        .route("/audit", get(get_audit))
}
