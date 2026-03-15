//! SSS Backend — API server for the Solana Stablecoin Standard.
//!
//! Provides REST endpoints for mint/burn operations, compliance management,
//! and webhook registration. Connects to Solana RPC for on-chain execution.

use std::env;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use axum::{
    extract::Request,
    http::{Method, StatusCode},
    middleware::{self, Next},
    response::Response,
};
use metrics_exporter_prometheus::PrometheusBuilder;
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use sss_backend::services::cache::{CacheBackend, RedisCache};
use sss_backend::services::compliance::ComplianceService;
use sss_backend::services::indexer::IndexerService;
use sss_backend::services::mint_burn::MintBurnService;
use sss_backend::services::operator_snapshots::OperatorSnapshotService;
use sss_backend::services::webhook::WebhookService;
use sss_backend::solana::{self, SolanaContext};
use sss_backend::AppState;

/// API-key authentication middleware.
///
/// Checks the `X-API-Key` header against the `SSS_API_KEY` environment variable.
/// Skips authentication for the `/health` and `/metrics` endpoints and when no
/// key is configured.
async fn auth_middleware(req: Request, next: Next) -> Result<Response, StatusCode> {
    let api_key = env::var("SSS_API_KEY").unwrap_or_default();
    if api_key.is_empty()
        || req.uri().path() == "/health"
        || req.uri().path() == "/metrics"
    {
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

/// Request metrics middleware.
///
/// Records `sss_http_requests_total` counter and `sss_http_request_duration_seconds`
/// histogram for every request, labelled by method, path, and status code.
async fn metrics_middleware(req: Request, next: Next) -> Response {
    let method = req.method().to_string();
    let path = req.uri().path().to_string();
    let start = Instant::now();

    let response = next.run(req).await;

    let status = response.status().as_u16().to_string();
    let duration = start.elapsed().as_secs_f64();

    let labels = [
        ("method", method),
        ("path", path),
        ("status", status),
    ];

    metrics::counter!("sss_http_requests_total", &labels).increment(1);
    metrics::histogram!(
        "sss_http_request_duration_seconds",
        &labels[..2]
    )
    .record(duration);

    response
}

/// Try to initialize the Solana context from environment variables.
///
/// Returns `None` if `SSS_MINT_ADDRESS` is not set (graceful degradation).
/// Panics on invalid configuration (bad addresses, unreadable keypair) since
/// those indicate misconfiguration that should be fixed before deployment.
fn init_solana_context() -> Option<Arc<SolanaContext>> {
    let mint_address = match env::var("SSS_MINT_ADDRESS") {
        Ok(addr) if !addr.is_empty() => addr,
        _ => {
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

fn backend_state_dir() -> PathBuf {
    env::var("SSS_BACKEND_STATE_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(".sss-backend-state"))
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

    // Initialize Prometheus metrics exporter
    let prometheus_handle = match PrometheusBuilder::new().install_recorder() {
        Ok(handle) => {
            tracing::info!("Prometheus metrics exporter initialized");
            Some(handle)
        }
        Err(e) => {
            tracing::warn!(error = %e, "Failed to install Prometheus recorder, metrics disabled");
            None
        }
    };

    // Try to connect to Redis; fall back to file-based persistence
    let redis_cache = match env::var("REDIS_URL") {
        Ok(url) if !url.is_empty() => match RedisCache::new(&url).await {
            Ok(cache) => {
                tracing::info!(url = %url, "Redis cache connected");
                Some(cache)
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "Failed to connect to Redis, falling back to file persistence"
                );
                None
            }
        },
        _ => None,
    };

    let state_dir = backend_state_dir();
    if redis_cache.is_none() {
        tracing::info!(state_dir = %state_dir.display(), "Using file-based persistence");
    }

    let solana_ctx = init_solana_context();

    // Initialize services with either Redis or file backend
    let webhook = match &redis_cache {
        Some(cache) => Arc::new(
            WebhookService::with_cache(CacheBackend::redis(cache.clone(), "sss:webhooks"))
                .await
                .expect("Failed to initialize webhook service with Redis"),
        ),
        None => Arc::new(
            WebhookService::with_persistence(state_dir.join("webhooks.json"))
                .expect("Failed to initialize webhook persistence"),
        ),
    };

    let operator_snapshots = match &redis_cache {
        Some(cache) => Arc::new(
            OperatorSnapshotService::with_cache(
                CacheBackend::redis(cache.clone(), "sss:operator_snapshots"),
            )
            .await
            .expect("Failed to initialize operator snapshot service with Redis"),
        ),
        None => Arc::new(
            OperatorSnapshotService::with_persistence(state_dir.join("operator_snapshots.json"))
                .expect("Failed to initialize operator snapshot persistence"),
        ),
    };

    let mint_burn = match solana_ctx.as_ref() {
        Some(ctx) => match &redis_cache {
            Some(cache) => Some(Arc::new(
                MintBurnService::with_cache(
                    Arc::clone(ctx),
                    CacheBackend::redis(cache.clone(), "sss:mint_burn"),
                )
                .await
                .expect("Failed to initialize mint/burn service with Redis"),
            )),
            None => Some(Arc::new(
                MintBurnService::with_persistence(
                    Arc::clone(ctx),
                    state_dir.join("mint_burn.json"),
                )
                .expect("Failed to initialize mint/burn persistence"),
            )),
        },
        None => None,
    };

    let compliance = match solana_ctx.as_ref() {
        Some(ctx) => match &redis_cache {
            Some(cache) => Some(Arc::new(
                ComplianceService::with_cache(
                    Arc::clone(ctx),
                    CacheBackend::redis(cache.clone(), "sss:compliance"),
                )
                .await
                .expect("Failed to initialize compliance service with Redis"),
            )),
            None => Some(Arc::new(
                ComplianceService::with_persistence(
                    Arc::clone(ctx),
                    state_dir.join("compliance.json"),
                )
                .expect("Failed to initialize compliance persistence"),
            )),
        },
        None => None,
    };

    let indexer = match solana_ctx.as_ref() {
        Some(ctx) => match &redis_cache {
            Some(cache) => Some(Arc::new(
                IndexerService::with_cache(
                    Arc::clone(ctx),
                    CacheBackend::redis(cache.clone(), "sss:indexer"),
                )
                .await
                .expect("Failed to initialize indexer service with Redis"),
            )),
            None => Some(Arc::new(
                IndexerService::with_persistence(
                    Arc::clone(ctx),
                    state_dir.join("indexer.json"),
                )
                .expect("Failed to initialize indexer persistence"),
            )),
        },
        None => None,
    };

    // Start the indexer background polling loop (every 10 seconds)
    if let Some(ref indexer_service) = indexer {
        let polling_interval = env::var("SSS_INDEXER_INTERVAL_SECS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(10);
        Arc::clone(indexer_service)
            .start_polling_with_webhooks(Arc::clone(&webhook), polling_interval);
    }

    let state = AppState {
        mint_burn,
        compliance,
        indexer,
        webhook,
        operator_snapshots,
        prometheus_handle,
    };

    // CORS configuration
    let cors = CorsLayer::new()
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_origin(Any)
        .allow_headers(Any);

    // Build the application router with middleware
    let app = sss_backend::build_router(state)
        .layer(middleware::from_fn(metrics_middleware))
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
