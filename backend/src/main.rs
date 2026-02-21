mod routes;
mod services;

use axum::{
    extract::Request,
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use std::env;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

async fn auth_middleware(req: Request, next: Next) -> Result<Response, StatusCode> {
    let api_key = env::var("SSS_API_KEY").unwrap_or_default();
    if api_key.is_empty() || req.uri().path() == "/health" {
        return Ok(next.run(req).await);
    }
    let auth_header = req.headers().get("x-api-key").and_then(|v| v.to_str().ok()).unwrap_or_default();
    if auth_header != api_key { return Err(StatusCode::UNAUTHORIZED); }
    Ok(next.run(req).await)
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "sss_backend=debug,tower_http=debug".into()))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_origin(Any)
        .allow_headers(Any);

    let app = Router::new()
        .merge(routes::health::router())
        .nest("/api/v1", routes::api_router())
        .layer(middleware::from_fn(auth_middleware))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    let port = env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    tracing::info!("SSS Backend starting on {}", addr);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
