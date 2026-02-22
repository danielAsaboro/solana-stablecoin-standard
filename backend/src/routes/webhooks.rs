//! Webhook registration and delivery routes.
//!
//! Provides REST endpoints for managing webhook registrations and
//! inspecting delivery history. The [`WebhookService`] is always available
//! (not gated behind Solana configuration).

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::services::webhook::{DeliveryRecord, DeliveryStatus, WebhookRegistration};
use crate::AppState;

// ── Request / Response Types ─────────────────────────────────────────────────

/// Request body for registering a new webhook.
#[derive(Deserialize)]
pub struct RegisterRequest {
    /// Target URL to receive HTTP POST deliveries.
    pub url: String,
    /// Event type filters. Empty array or omitted means all events.
    #[serde(default)]
    pub events: Vec<String>,
    /// Optional HMAC-SHA256 secret for payload signing.
    pub secret: Option<String>,
}

/// Response body for webhook registration operations.
#[derive(Serialize)]
pub struct WebhookResponse {
    /// Unique registration identifier.
    pub id: String,
    /// Target URL.
    pub url: String,
    /// Event type filters.
    pub events: Vec<String>,
    /// Whether the webhook is actively receiving deliveries.
    pub active: bool,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
    /// ISO 8601 timestamp of the most recent delivery attempt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_delivery_at: Option<String>,
    /// Total successful deliveries.
    pub delivery_count: u64,
    /// Total failed deliveries.
    pub failure_count: u64,
}

impl From<WebhookRegistration> for WebhookResponse {
    fn from(reg: WebhookRegistration) -> Self {
        Self {
            id: reg.id,
            url: reg.url,
            events: reg.events,
            active: reg.active,
            created_at: reg.created_at,
            last_delivery_at: reg.last_delivery_at,
            delivery_count: reg.delivery_count,
            failure_count: reg.failure_count,
        }
    }
}

/// Response body for delivery log entries.
#[derive(Serialize)]
pub struct DeliveryResponse {
    /// Unique delivery identifier.
    pub id: String,
    /// The webhook registration this delivery was sent to.
    pub webhook_id: String,
    /// The event type that triggered this delivery.
    pub event_type: String,
    /// Current delivery status.
    pub status: String,
    /// Number of delivery attempts made.
    pub attempts: u32,
    /// ISO 8601 timestamp of the most recent attempt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_attempt_at: Option<String>,
    /// HTTP response status code from the most recent attempt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_code: Option<u16>,
    /// Error message from the most recent failed attempt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// ISO 8601 creation timestamp.
    pub created_at: String,
}

impl From<DeliveryRecord> for DeliveryResponse {
    fn from(rec: DeliveryRecord) -> Self {
        Self {
            id: rec.id,
            webhook_id: rec.webhook_id,
            event_type: rec.event_type,
            status: match rec.status {
                DeliveryStatus::Pending => "pending",
                DeliveryStatus::Delivered => "delivered",
                DeliveryStatus::Failed => "failed",
            }
            .to_string(),
            attempts: rec.attempts,
            last_attempt_at: rec.last_attempt_at,
            response_code: rec.response_code,
            error: rec.error,
            created_at: rec.created_at,
        }
    }
}

/// Query parameters for the delivery log endpoint.
#[derive(Deserialize)]
pub struct DeliveryQuery {
    /// Maximum number of delivery records to return (default: 100, max: 1000).
    pub limit: Option<usize>,
}

/// Response body for the unregister endpoint.
#[derive(Serialize)]
pub struct DeleteResponse {
    /// Confirmation message.
    pub message: String,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// POST /webhooks — Register a new webhook endpoint.
async fn register_webhook(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<(StatusCode, Json<WebhookResponse>), AppError> {
    if req.url.is_empty() {
        return Err(AppError::InvalidInput("url is required".to_string()));
    }

    // Basic URL validation
    if !req.url.starts_with("http://") && !req.url.starts_with("https://") {
        return Err(AppError::InvalidInput(
            "url must start with http:// or https://".to_string(),
        ));
    }

    let registration = state
        .webhook
        .register(req.url, req.events, req.secret)
        .await;

    Ok((StatusCode::CREATED, Json(WebhookResponse::from(registration))))
}

/// GET /webhooks — List all webhook registrations.
async fn list_webhooks(
    State(state): State<AppState>,
) -> Result<Json<Vec<WebhookResponse>>, AppError> {
    let registrations = state.webhook.list_registrations().await;
    Ok(Json(
        registrations
            .into_iter()
            .map(WebhookResponse::from)
            .collect(),
    ))
}

/// GET /webhooks/deliveries — List recent delivery records.
///
/// NOTE: This route is registered before `/webhooks/:id` to avoid path conflicts.
async fn list_deliveries(
    State(state): State<AppState>,
    Query(query): Query<DeliveryQuery>,
) -> Result<Json<Vec<DeliveryResponse>>, AppError> {
    let limit = query.limit.unwrap_or(100).min(1000);
    let records = state.webhook.get_delivery_log(limit).await;
    Ok(Json(
        records.into_iter().map(DeliveryResponse::from).collect(),
    ))
}

/// GET /webhooks/:id — Get a specific webhook registration.
async fn get_webhook(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<WebhookResponse>, AppError> {
    let registration = state
        .webhook
        .get_registration(&id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Webhook '{id}' not found")))?;

    Ok(Json(WebhookResponse::from(registration)))
}

/// DELETE /webhooks/:id — Unregister a webhook endpoint.
async fn unregister_webhook(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<DeleteResponse>, AppError> {
    state.webhook.unregister(&id).await?;
    Ok(Json(DeleteResponse {
        message: format!("Webhook '{id}' unregistered"),
    }))
}

// ── Router ───────────────────────────────────────────────────────────────────

/// Build the webhook routes sub-router.
///
/// Routes:
/// - `POST   /webhooks`              — Register a new webhook
/// - `GET    /webhooks`              — List all registrations
/// - `GET    /webhooks/deliveries`   — List recent delivery records
/// - `GET    /webhooks/:id`          — Get a specific registration
/// - `DELETE /webhooks/:id`          — Unregister a webhook
pub fn router() -> Router<AppState> {
    Router::new()
        .route("/webhooks", post(register_webhook).get(list_webhooks))
        .route("/webhooks/deliveries", get(list_deliveries))
        .route(
            "/webhooks/{id}",
            get(get_webhook).delete(unregister_webhook),
        )
}
