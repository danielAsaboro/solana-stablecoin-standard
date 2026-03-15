pub mod compliance;
pub mod health;
pub mod indexer;
pub mod metrics;
pub mod mint_burn;
pub mod operator_timeline;
pub mod webhooks;

use axum::Router;

use crate::AppState;

/// Build the versioned API router (`/api/v1/*`).
pub fn api_router() -> Router<AppState> {
    Router::new()
        .merge(mint_burn::router())
        .merge(compliance::router())
        .merge(webhooks::router())
        .merge(indexer::router())
        .merge(operator_timeline::router())
}
