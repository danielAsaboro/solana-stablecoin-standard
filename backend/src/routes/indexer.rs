//! Indexer API routes — query indexed on-chain events.
//!
//! All handlers extract [`AppState`] to access the [`IndexerService`].
//! Returns 503 Service Unavailable if the Solana context is not configured.

use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::services::indexer::{EventFilter, IndexedEvent, IndexerService};
use crate::AppState;

// ── Query / Response Types ──────────────────────────────────────────────

/// Query parameters for the `GET /events` endpoint.
#[derive(Deserialize)]
pub struct EventsQuery {
    /// Filter by event type name (e.g. "TokensMinted").
    pub event_type: Option<String>,
    /// Maximum number of events to return (default 100, max 1000).
    pub limit: Option<usize>,
    /// Pagination cursor — return events before this transaction signature.
    pub before_signature: Option<String>,
}

/// Response for the `GET /events/count` endpoint.
#[derive(Serialize)]
pub struct EventCountResponse {
    /// Total number of indexed events.
    pub count: usize,
}

/// Response for the `GET /events/status` endpoint.
#[derive(Serialize)]
pub struct IndexerStatusResponse {
    /// Total number of indexed events.
    pub total_events: usize,
    /// The slot of the most recently indexed event, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_slot: Option<u64>,
    /// The config PDA address being indexed.
    pub config_address: String,
    /// The SSS program ID.
    pub program_id: String,
}

// ── Helper ──────────────────────────────────────────────────────────────

/// Extract the IndexerService from AppState, returning 503 if not configured.
fn get_service(state: &AppState) -> Result<&IndexerService, AppError> {
    state.indexer.as_deref().ok_or_else(|| {
        AppError::NotConfigured(
            "Solana not configured. Set SSS_MINT_ADDRESS and SSS_KEYPAIR_PATH.".to_string(),
        )
    })
}

// ── Handlers ────────────────────────────────────────────────────────────

/// List indexed events with optional filtering and pagination.
///
/// Query parameters:
/// - `event_type` — filter by event type name
/// - `limit` — max results (default 100, max 1000)
/// - `before_signature` — pagination cursor
async fn list_events(
    State(state): State<AppState>,
    Query(query): Query<EventsQuery>,
) -> Result<Json<Vec<IndexedEvent>>, AppError> {
    let service = get_service(&state)?;
    let limit = query.limit.unwrap_or(100).min(1000);
    let filter = EventFilter {
        event_type: query.event_type,
        limit: Some(limit),
        before_signature: query.before_signature,
    };
    let events = service.get_events(filter).await;
    Ok(Json(events))
}

/// Return the total count of indexed events.
async fn event_count(
    State(state): State<AppState>,
) -> Result<Json<EventCountResponse>, AppError> {
    let service = get_service(&state)?;
    let count = service.get_event_count().await;
    Ok(Json(EventCountResponse { count }))
}

/// Return indexer status including total events, latest slot, and config info.
async fn indexer_status(
    State(state): State<AppState>,
) -> Result<Json<IndexerStatusResponse>, AppError> {
    let service = get_service(&state)?;
    let total_events = service.get_event_count().await;
    let latest_slot = service.get_latest_slot().await;
    Ok(Json(IndexerStatusResponse {
        total_events,
        latest_slot,
        config_address: service.config_address(),
        program_id: service.program_id(),
    }))
}

/// Build the indexer API router.
///
/// Routes:
/// - `GET /events` — list indexed events
/// - `GET /events/count` — total event count
/// - `GET /events/status` — indexer status
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/events", get(list_events))
        .route("/events/count", get(event_count))
        .route("/events/status", get(indexer_status))
}
