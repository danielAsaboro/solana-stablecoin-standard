//! SSS Backend — API server for the Solana Stablecoin Standard.
//!
//! Provides REST endpoints for mint/burn operations, compliance management,
//! and webhook registration. Connects to Solana RPC for on-chain execution.

use std::env;
use std::sync::Arc;

use axum::{
    extract::Request,
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::Response,
};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use sss_backend::services::compliance::ComplianceService;
use sss_backend::services::indexer::IndexerService;
use sss_backend::services::mint_burn::MintBurnService;
use sss_backend::services::webhook::WebhookService;
use sss_backend::solana::{self, SolanaContext};
use sss_backend::AppState;

/// API-key authentication middleware.
///
/// Checks the `X-API-Key` header against the `SSS_API_KEY` environment variable.
/// Skips authentication for the `/health` endpoint and when no key is configured.
async fn auth_middleware(req: Request, next: Next) -> Result<Response, StatusCode> {
    let api_key = env::var("SSS_API_KEY").unwrap_or_default();
    if api_key.is_empty() || req.uri().path() == "/health" {
        return Ok(next.run(req).await);
    }
    let auth_header = req
        .headers()
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if auth_header != api_key {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(next.run(req).await)
}

/// Try to initialize the Solana context from environment variables.
///
/// Returns `None` if `SSS_MINT_ADDRESS` is not set (graceful degradation).
/// Panics on invalid configuration (bad addresses, unreadable keypair) since
/// those indicate misconfiguration that should be fixed before deployment.
fn init_solana_context() -> Option<Arc<SolanaContext>> {
    let mint_address = match env::var("SSS_MINT_ADDRESS") {
        Ok(addr) => addr,
        Err(_) => {
            tracing::warn!(
                "SSS_MINT_ADDRESS not set — Solana operations will be unavailable. \
                 Set SSS_MINT_ADDRESS, SSS_PROGRAM_ID, and SSS_KEYPAIR_PATH to enable."
            );
            return None;
        }
    };

    let rpc_url = env::var("RPC_URL").unwrap_or_else(|_| "http://127.0.0.1:8899".to_string());

    let program_id_str = env::var("SSS_PROGRAM_ID")
        .unwrap_or_else(|_| "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu".to_string());
    let program_id = solana::parse_pubkey(&program_id_str)
        .expect("SSS_PROGRAM_ID must be a valid base58 address");

    let mint = solana::parse_pubkey(&mint_address)
        .expect("SSS_MINT_ADDRESS must be a valid base58 address");

    let keypair_path = env::var("SSS_KEYPAIR_PATH").unwrap_or_else(|_| {
        let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
        format!("{home}/.config/solana/id.json")
    });
    let keypair = solana::load_keypair_from_file(&keypair_path)
        .expect("Failed to load service keypair from SSS_KEYPAIR_PATH");

    tracing::info!(
        rpc = %rpc_url,
        program = %program_id,
        mint = %mint,
        keypair = %keypair_path,
        "Solana context initialized"
    );

    Some(Arc::new(SolanaContext::new(
        &rpc_url,
        program_id,
        mint,
        keypair,
    )))
}

#[tokio::main]
async fn main() {
    // Initialize structured logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sss_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Initialize Solana context (optional — backend works without it)
    let solana_ctx = init_solana_context();
    let mint_burn = solana_ctx
        .as_ref()
        .map(|ctx| Arc::new(MintBurnService::new(Arc::clone(ctx))));
    let compliance = solana_ctx
        .as_ref()
        .map(|ctx| Arc::new(ComplianceService::new(Arc::clone(ctx))));
    let indexer = solana_ctx
        .as_ref()
        .map(|ctx| Arc::new(IndexerService::new(Arc::clone(ctx))));

    // Start the indexer background polling loop (every 10 seconds)
    if let Some(ref indexer_service) = indexer {
        let polling_interval = env::var("SSS_INDEXER_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(10);
        Arc::clone(indexer_service).start_polling(polling_interval);
    }

    // Webhook service is always available (no Solana dependency)
    let webhook = Arc::new(WebhookService::new());

    let state = AppState {
        mint_burn,
        compliance,
        indexer,
        webhook,
    };

    // CORS configuration
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_origin(Any)
        .allow_headers(Any);

    // Build the application router with middleware
    let app = sss_backend::build_router(state)
        .layer(middleware::from_fn(auth_middleware))
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    // Start the server
    let port = env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("SSS Backend starting on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .expect("Failed to bind to address");
    axum::serve(listener, app)
        .await
        .expect("Server exited unexpectedly");
}
