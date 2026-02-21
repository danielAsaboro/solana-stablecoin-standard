pub mod health;
pub mod mint_burn;
pub mod compliance;
pub mod webhooks;

use axum::Router;

pub fn api_router() -> Router {
    Router::new()
        .merge(mint_burn::router())
        .merge(compliance::router())
        .merge(webhooks::router())
}
