pub mod compliance;
pub mod health;
pub mod indexer;
pub mod mint_burn;
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
}
