//! Prometheus metrics endpoint — renders collected metrics in text exposition format.

use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Router};

use crate::AppState;

async fn metrics_handler(State(state): State<AppState>) -> impl IntoResponse {
    match state.prometheus_handle {
        Some(ref handle) => (StatusCode::OK, handle.render()),
        None => (
            StatusCode::SERVICE_UNAVAILABLE,
            "Metrics not configured".to_string(),
        ),
    }
}

/// Metrics router — mounted at `/metrics`.
pub fn router() -> Router<AppState> {
    Router::new().route("/metrics", get(metrics_handler))
}
