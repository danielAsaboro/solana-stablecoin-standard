//! Health check endpoint — always available regardless of Solana configuration.
//!
//! Reports the status of all backend services: mint/burn, compliance, indexer,
//! and webhooks.

use axum::{extract::State, routing::get, Json, Router};
use serde::Serialize;

use crate::AppState;

/// Health check response with per-service availability.
#[derive(Serialize)]
pub struct HealthResponse {
    /// Overall backend status.
    pub status: String,
    /// Backend package version.
    pub version: String,
    /// Whether the Solana RPC context is configured.
    pub solana_configured: bool,
    /// Per-service availability.
    pub services: ServiceStatus,
}

/// Availability status of each backend service.
#[derive(Serialize)]
pub struct ServiceStatus {
    /// Mint/burn operations available.
    pub mint_burn: bool,
    /// Compliance (blacklist) operations available.
    pub compliance: bool,
    /// Event indexer running.
    pub indexer: bool,
    /// Webhook dispatch available.
    pub webhooks: bool,
}

async fn health_check(State(state): State<AppState>) -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        solana_configured: state.mint_burn.is_some(),
        services: ServiceStatus {
            mint_burn: state.mint_burn.is_some(),
            compliance: state.compliance.is_some(),
            indexer: state.indexer.is_some(),
            webhooks: true, // always available
        },
    })
}

/// Health check router — mounted at `/health`.
pub fn router() -> Router<AppState> {
    Router::new().route("/health", get(health_check))
}
