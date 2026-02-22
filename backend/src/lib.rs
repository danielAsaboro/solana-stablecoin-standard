//! SSS Backend library — re-exports all modules for integration testing.
//!
//! This library crate exposes the backend's core types, services, routes,
//! and Solana integration modules. The binary crate (`main.rs`) adds
//! middleware layers (auth, CORS, tracing) and startup logic.

pub mod error;
pub mod routes;
pub mod services;
pub mod solana;

use std::sync::Arc;

use services::compliance::ComplianceService;
use services::indexer::IndexerService;
use services::mint_burn::MintBurnService;
use services::webhook::WebhookService;

/// Shared application state passed to all route handlers via Axum's `State` extractor.
#[derive(Clone)]
pub struct AppState {
    /// MintBurn service — `None` if Solana context is not configured.
    pub mint_burn: Option<Arc<MintBurnService>>,
    /// Compliance service — `None` if Solana context is not configured.
    pub compliance: Option<Arc<ComplianceService>>,
    /// Indexer service — `None` if Solana context is not configured.
    pub indexer: Option<Arc<IndexerService>>,
    /// Webhook service — always available (no Solana dependency).
    pub webhook: Arc<WebhookService>,
}

/// Build the application router with the given state.
///
/// Returns the full Axum router with health, API, and webhook routes.
/// Does **not** include middleware layers (CORS, auth, tracing) — those
/// are added by the binary crate for production, or omitted in tests.
pub fn build_router(state: AppState) -> axum::Router {
    axum::Router::<AppState>::new()
        .merge(routes::health::router())
        .nest("/api/v1", routes::api_router())
        .with_state(state)
}
