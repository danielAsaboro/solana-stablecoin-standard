//! Webhook service — notify external systems on stablecoin events.
//!
//! Manages webhook registrations, dispatches event payloads via HTTP POST,
//! signs payloads with HMAC-SHA256 when a secret is configured, and retries
//! failed deliveries with exponential backoff.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::AppError;
use crate::persistence::JsonFileStore;

/// HMAC-SHA256 type alias used for payload signing.
type HmacSha256 = Hmac<Sha256>;

/// Maximum number of delivery retries for transient failures.
pub const MAX_RETRIES: u32 = 3;

/// Header name carrying the HMAC signature for signed webhook deliveries.
pub const SIGNATURE_HEADER_NAME: &str = "X-SSS-Signature";

/// Human-readable algorithm label for signed webhook deliveries.
pub const SIGNATURE_ALGORITHM: &str = "HMAC-SHA256";

/// Base backoff duration in seconds (doubles each retry: 1s, 2s, 4s).
const BASE_BACKOFF_SECS: u64 = 1;

/// Maximum number of delivery records to keep in the in-memory log.
const MAX_DELIVERY_LOG: usize = 10_000;

// ── Data Types ───────────────────────────────────────────────────────────────

/// A registered webhook endpoint with its configuration and delivery statistics.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookRegistration {
    /// Unique registration identifier (UUID v4).
    pub id: String,
    /// Target URL to receive HTTP POST deliveries.
    pub url: String,
    /// Event type filters. Empty means all events are delivered.
    pub events: Vec<String>,
    /// Optional HMAC-SHA256 secret for payload signing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub secret: Option<String>,
    /// Whether this webhook is actively receiving deliveries.
    pub active: bool,
    /// ISO 8601 timestamp when the webhook was registered.
    pub created_at: String,
    /// ISO 8601 timestamp of the most recent delivery attempt.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_delivery_at: Option<String>,
    /// Total number of successful deliveries.
    pub delivery_count: u64,
    /// Total number of failed deliveries.
    pub failure_count: u64,
}

impl WebhookRegistration {
    /// Whether this registration signs outgoing payloads.
    pub fn signing_enabled(&self) -> bool {
        self.secret.is_some()
    }
}

/// Non-secret correlation metadata attached to webhook payloads and delivery logs.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DispatchMetadata {
    /// Stable incident correlation key for operator tooling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    /// On-chain transaction signature that originated the event, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transaction_signature: Option<String>,
    /// Indexed event identifier, when the event came from the backend indexer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
}

/// Payload sent to webhook endpoints via HTTP POST.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookPayload {
    /// Unique delivery identifier (UUID v4).
    pub id: String,
    /// The type of event that triggered this delivery.
    pub event_type: String,
    /// ISO 8601 timestamp of the event.
    pub timestamp: String,
    /// Stable incident correlation key for operator tooling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    /// On-chain transaction signature that originated the event, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transaction_signature: Option<String>,
    /// Indexed event identifier, when the event came from the backend indexer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    /// Event-specific data.
    pub data: serde_json::Value,
}

/// Status of a webhook delivery attempt.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryStatus {
    /// Delivery is queued or in progress.
    Pending,
    /// Delivery completed successfully (2xx response).
    Delivered,
    /// Delivery failed after all retry attempts.
    Failed,
}

/// Record of a single webhook delivery attempt with its outcome.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeliveryRecord {
    /// Unique delivery identifier (UUID v4).
    pub id: String,
    /// The webhook registration this delivery was sent to.
    pub webhook_id: String,
    /// The event type that triggered this delivery.
    pub event_type: String,
    /// Stable incident correlation key for operator tooling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub correlation_id: Option<String>,
    /// On-chain transaction signature that originated the event, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transaction_signature: Option<String>,
    /// Indexed event identifier, when the event came from the backend indexer.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    /// Replay relationship for operator-triggered redelivery attempts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub replayed_from: Option<String>,
    /// Current delivery status.
    pub status: DeliveryStatus,
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
    /// ISO 8601 timestamp when this delivery was created.
    pub created_at: String,
    /// Payload snapshot used for delivery and replay.
    pub payload: WebhookPayload,
}

// ── Service ──────────────────────────────────────────────────────────────────

/// Service for managing webhook registrations and dispatching event deliveries.
///
/// Stores registrations and delivery records in memory using `RwLock`-protected
/// `HashMap`s. Event dispatch is non-blocking: each delivery runs in a spawned
/// Tokio task with automatic retry on transient failures.
pub struct WebhookService {
    /// Registered webhook endpoints keyed by registration ID.
    registrations: RwLock<HashMap<String, WebhookRegistration>>,
    /// Delivery log keyed by delivery ID.
    delivery_log: RwLock<HashMap<String, DeliveryRecord>>,
    /// Shared HTTP client reused across all deliveries.
    http_client: reqwest::Client,
    /// Optional local JSON persistence store.
    store: Option<JsonFileStore>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedWebhookState {
    registrations: HashMap<String, WebhookRegistration>,
    delivery_log: HashMap<String, DeliveryRecord>,
}

impl WebhookService {
    /// Create a new webhook service with empty registrations and delivery log.
    pub fn new() -> Self {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();

        Self {
            registrations: RwLock::new(HashMap::new()),
            delivery_log: RwLock::new(HashMap::new()),
            http_client,
            store: None,
        }
    }

    /// Create a new webhook service backed by a local JSON persistence file.
    pub fn with_persistence(path: impl Into<PathBuf>) -> Result<Self, AppError> {
        let http_client = reqwest::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default();
        let store = JsonFileStore::new(path)?;
        let persisted: PersistedWebhookState = store.load_or_default()?;

        Ok(Self {
            registrations: RwLock::new(persisted.registrations),
            delivery_log: RwLock::new(persisted.delivery_log),
            http_client,
            store: Some(store),
        })
    }

    /// Register a new webhook endpoint.
    ///
    /// # Arguments
    /// * `url` — Target URL that will receive HTTP POST deliveries.
    /// * `events` — Event type filters. Pass an empty `Vec` to receive all events.
    /// * `secret` — Optional HMAC-SHA256 secret for payload signing.
    ///
    /// # Returns
    /// The created [`WebhookRegistration`] with a generated UUID and initial counters.
    pub async fn register(
        &self,
        url: String,
        events: Vec<String>,
        secret: Option<String>,
    ) -> WebhookRegistration {
        let id = Uuid::new_v4().to_string();
        let registration = WebhookRegistration {
            id: id.clone(),
            url: url.clone(),
            events: events.clone(),
            secret,
            active: true,
            created_at: Utc::now().to_rfc3339(),
            last_delivery_at: None,
            delivery_count: 0,
            failure_count: 0,
        };

        self.registrations
            .write()
            .await
            .insert(id.clone(), registration.clone());
        self.persist_state().await;

        tracing::info!(
            webhook_id = %id,
            url = %url,
            events = ?events,
            "Webhook registered"
        );

        registration
    }

    /// Unregister a webhook endpoint by its ID.
    ///
    /// # Errors
    /// Returns [`AppError::NotFound`] if no registration exists with the given ID.
    pub async fn unregister(&self, id: &str) -> Result<(), AppError> {
        let removed = self.registrations.write().await.remove(id);
        match removed {
            Some(reg) => {
                tracing::info!(webhook_id = %id, url = %reg.url, "Webhook unregistered");
                self.persist_state().await;
                Ok(())
            }
            None => Err(AppError::NotFound(format!(
                "Webhook registration '{id}' not found"
            ))),
        }
    }

    /// List all current webhook registrations.
    pub async fn list_registrations(&self) -> Vec<WebhookRegistration> {
        let regs = self.registrations.read().await;
        let mut list: Vec<_> = regs.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list
    }

    /// Get a specific webhook registration by ID.
    ///
    /// Returns `None` if no registration exists with the given ID.
    pub async fn get_registration(&self, id: &str) -> Option<WebhookRegistration> {
        self.registrations.read().await.get(id).cloned()
    }

    /// Dispatch an event to all matching registered webhooks.
    ///
    /// For each active registration whose event filters match the given
    /// `event_type` (or that has no filters), a delivery task is spawned.
    /// Deliveries run concurrently in the background with automatic retry
    /// on transient failures (5xx or network errors).
    pub async fn dispatch_event(self: &Arc<Self>, event_type: &str, data: serde_json::Value) {
        self.dispatch_event_with_context(event_type, data, DispatchMetadata::default())
            .await;
    }

    /// Dispatch an event with correlation metadata for operator tooling.
    pub async fn dispatch_event_with_context(
        self: &Arc<Self>,
        event_type: &str,
        data: serde_json::Value,
        metadata: DispatchMetadata,
    ) {
        let registrations = self.registrations.read().await;
        let matching: Vec<WebhookRegistration> = registrations
            .values()
            .filter(|r| r.active)
            .filter(|r| r.events.is_empty() || r.events.iter().any(|e| e == event_type))
            .cloned()
            .collect();
        drop(registrations);

        if matching.is_empty() {
            tracing::debug!(event_type = %event_type, "No matching webhooks for event");
            return;
        }

        tracing::info!(
            event_type = %event_type,
            webhook_count = matching.len(),
            correlation_id = metadata.correlation_id.as_deref().unwrap_or("none"),
            transaction_signature = metadata.transaction_signature.as_deref().unwrap_or("none"),
            "Dispatching event to webhooks"
        );

        for registration in matching {
            let payload = WebhookPayload {
                id: Uuid::new_v4().to_string(),
                event_type: event_type.to_string(),
                timestamp: Utc::now().to_rfc3339(),
                correlation_id: metadata.correlation_id.clone(),
                transaction_signature: metadata.transaction_signature.clone(),
                event_id: metadata.event_id.clone(),
                data: data.clone(),
            };

            let delivery_id = payload.id.clone();
            let record = DeliveryRecord {
                id: delivery_id.clone(),
                webhook_id: registration.id.clone(),
                event_type: event_type.to_string(),
                correlation_id: metadata.correlation_id.clone(),
                transaction_signature: metadata.transaction_signature.clone(),
                event_id: metadata.event_id.clone(),
                replayed_from: None,
                status: DeliveryStatus::Pending,
                attempts: 0,
                last_attempt_at: None,
                response_code: None,
                error: None,
                created_at: Utc::now().to_rfc3339(),
                payload: payload.clone(),
            };

            self.delivery_log
                .write()
                .await
                .insert(delivery_id.clone(), record);

            // Trim the delivery log if it exceeds the maximum size
            self.trim_delivery_log().await;
            self.persist_state().await;

            let service = Arc::clone(self);
            tokio::spawn(async move {
                service
                    .deliver_with_retry(registration, payload, delivery_id)
                    .await;
            });
        }
    }

    /// Retrieve recent delivery records, newest first.
    ///
    /// # Arguments
    /// * `limit` — Maximum number of records to return.
    pub async fn get_delivery_log(&self, limit: usize) -> Vec<DeliveryRecord> {
        let log = self.delivery_log.read().await;
        let mut list: Vec<_> = log.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list.truncate(limit);
        list
    }

    /// Get a single delivery record by ID.
    pub async fn get_delivery(&self, id: &str) -> Option<DeliveryRecord> {
        self.delivery_log.read().await.get(id).cloned()
    }

    /// Redeliver a recorded payload to the original webhook registration.
    pub async fn redeliver(self: &Arc<Self>, id: &str) -> Result<DeliveryRecord, AppError> {
        let original = self
            .delivery_log
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("Delivery '{id}' not found")))?;

        let registration = self
            .registrations
            .read()
            .await
            .get(&original.webhook_id)
            .cloned()
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "Webhook registration '{}' not found for delivery '{}'",
                    original.webhook_id, id
                ))
            })?;

        let payload = WebhookPayload {
            id: Uuid::new_v4().to_string(),
            ..original.payload.clone()
        };
        let delivery_id = payload.id.clone();
        let record = DeliveryRecord {
            id: delivery_id.clone(),
            webhook_id: registration.id.clone(),
            event_type: original.event_type.clone(),
            correlation_id: original.correlation_id.clone(),
            transaction_signature: original.transaction_signature.clone(),
            event_id: original.event_id.clone(),
            replayed_from: Some(original.id),
            status: DeliveryStatus::Pending,
            attempts: 0,
            last_attempt_at: None,
            response_code: None,
            error: None,
            created_at: Utc::now().to_rfc3339(),
            payload: payload.clone(),
        };

        self.delivery_log
            .write()
            .await
            .insert(delivery_id.clone(), record.clone());
        self.trim_delivery_log().await;
        self.persist_state().await;

        let service = Arc::clone(self);
        tokio::spawn(async move {
            service
                .deliver_with_retry(registration, payload, delivery_id)
                .await;
        });

        Ok(record)
    }

    /// Attempt to deliver a payload to a webhook with retry logic.
    ///
    /// Retries up to [`MAX_RETRIES`] times with exponential backoff (1s, 2s, 4s)
    /// for 5xx responses and network errors. 4xx responses are treated as
    /// permanent failures and are not retried.
    async fn deliver_with_retry(
        &self,
        registration: WebhookRegistration,
        payload: WebhookPayload,
        delivery_id: String,
    ) {
        let payload_json = match serde_json::to_string(&payload) {
            Ok(json) => json,
            Err(e) => {
                tracing::error!(
                    delivery_id = %delivery_id,
                    error = %e,
                    "Failed to serialize webhook payload"
                );
                self.update_delivery_record(
                    &delivery_id,
                    DeliveryStatus::Failed,
                    1,
                    None,
                    Some(format!("Serialization error: {e}")),
                )
                .await;
                self.increment_failure(&registration.id).await;
                return;
            }
        };

        let mut attempts: u32 = 0;

        loop {
            attempts = attempts.saturating_add(1);
            let now = Utc::now().to_rfc3339();

            let mut request = self
                .http_client
                .post(&registration.url)
                .header("Content-Type", "application/json")
                .header("User-Agent", "SSS-Webhook/1.0");

            // Compute HMAC-SHA256 signature if secret is configured
            if let Some(ref secret) = registration.secret {
                if let Ok(signature) = compute_hmac_signature(secret, &payload_json) {
                    request = request.header(SIGNATURE_HEADER_NAME, signature);
                }
            }

            request = request.body(payload_json.clone());

            tracing::debug!(
                delivery_id = %delivery_id,
                webhook_id = %registration.id,
                url = %registration.url,
                attempt = attempts,
                "Sending webhook delivery"
            );

            match request.send().await {
                Ok(response) => {
                    let status_code = response.status().as_u16();

                    if response.status().is_success() {
                        // Successful delivery
                        tracing::info!(
                            delivery_id = %delivery_id,
                            webhook_id = %registration.id,
                            status = status_code,
                            attempts = attempts,
                            "Webhook delivered successfully"
                        );
                        self.update_delivery_record(
                            &delivery_id,
                            DeliveryStatus::Delivered,
                            attempts,
                            Some(status_code),
                            None,
                        )
                        .await;
                        self.increment_success(&registration.id, &now).await;
                        return;
                    } else if response.status().is_client_error() {
                        // 4xx — permanent failure, do not retry
                        let error_msg = format!("HTTP {status_code} client error");
                        tracing::error!(
                            delivery_id = %delivery_id,
                            webhook_id = %registration.id,
                            status = status_code,
                            "Webhook delivery failed with client error (no retry)"
                        );
                        self.update_delivery_record(
                            &delivery_id,
                            DeliveryStatus::Failed,
                            attempts,
                            Some(status_code),
                            Some(error_msg),
                        )
                        .await;
                        self.increment_failure(&registration.id).await;
                        return;
                    } else if response.status().is_server_error() {
                        // 5xx — transient failure, retry if attempts remain
                        let error_msg = format!("HTTP {status_code} server error");
                        tracing::warn!(
                            delivery_id = %delivery_id,
                            webhook_id = %registration.id,
                            status = status_code,
                            attempt = attempts,
                            "Webhook delivery got server error, will retry"
                        );
                        self.update_delivery_record(
                            &delivery_id,
                            DeliveryStatus::Pending,
                            attempts,
                            Some(status_code),
                            Some(error_msg),
                        )
                        .await;

                        if attempts >= MAX_RETRIES {
                            tracing::error!(
                                delivery_id = %delivery_id,
                                webhook_id = %registration.id,
                                "Webhook delivery exhausted all retries"
                            );
                            self.update_delivery_record(
                                &delivery_id,
                                DeliveryStatus::Failed,
                                attempts,
                                Some(status_code),
                                Some(format!("Exhausted {MAX_RETRIES} retries: HTTP {status_code}")),
                            )
                            .await;
                            self.increment_failure(&registration.id).await;
                            return;
                        }
                    } else {
                        // Other status codes — treat as transient
                        let error_msg = format!("HTTP {status_code} unexpected status");
                        self.update_delivery_record(
                            &delivery_id,
                            DeliveryStatus::Pending,
                            attempts,
                            Some(status_code),
                            Some(error_msg),
                        )
                        .await;

                        if attempts >= MAX_RETRIES {
                            self.update_delivery_record(
                                &delivery_id,
                                DeliveryStatus::Failed,
                                attempts,
                                Some(status_code),
                                Some(format!("Exhausted {MAX_RETRIES} retries: HTTP {status_code}")),
                            )
                            .await;
                            self.increment_failure(&registration.id).await;
                            return;
                        }
                    }
                }
                Err(e) => {
                    // Network error — retry if attempts remain
                    let error_msg = format!("Network error: {e}");
                    tracing::warn!(
                        delivery_id = %delivery_id,
                        webhook_id = %registration.id,
                        error = %e,
                        attempt = attempts,
                        "Webhook delivery network error, will retry"
                    );
                    self.update_delivery_record(
                        &delivery_id,
                        DeliveryStatus::Pending,
                        attempts,
                        None,
                        Some(error_msg.clone()),
                    )
                    .await;

                    if attempts >= MAX_RETRIES {
                        tracing::error!(
                            delivery_id = %delivery_id,
                            webhook_id = %registration.id,
                            "Webhook delivery exhausted all retries after network errors"
                        );
                        self.update_delivery_record(
                            &delivery_id,
                            DeliveryStatus::Failed,
                            attempts,
                            None,
                            Some(format!("Exhausted {MAX_RETRIES} retries: {error_msg}")),
                        )
                        .await;
                        self.increment_failure(&registration.id).await;
                        return;
                    }
                }
            }

            // Exponential backoff: 1s, 2s, 4s
            let backoff = Duration::from_secs(
                BASE_BACKOFF_SECS.saturating_mul(
                    2u64.saturating_pow(attempts.saturating_sub(1)),
                ),
            );
            tracing::debug!(
                delivery_id = %delivery_id,
                backoff_secs = backoff.as_secs(),
                "Waiting before retry"
            );
            tokio::time::sleep(backoff).await;
        }
    }

    /// Update a delivery record in the log.
    async fn update_delivery_record(
        &self,
        delivery_id: &str,
        status: DeliveryStatus,
        attempts: u32,
        response_code: Option<u16>,
        error: Option<String>,
    ) {
        let mut log = self.delivery_log.write().await;
        if let Some(record) = log.get_mut(delivery_id) {
            record.status = status;
            record.attempts = attempts;
            record.last_attempt_at = Some(Utc::now().to_rfc3339());
            record.response_code = response_code;
            record.error = error;
        }
        drop(log);
        self.persist_state().await;
    }

    /// Increment the success counter and update last_delivery_at for a registration.
    async fn increment_success(&self, webhook_id: &str, timestamp: &str) {
        let mut regs = self.registrations.write().await;
        if let Some(reg) = regs.get_mut(webhook_id) {
            reg.delivery_count = reg.delivery_count.saturating_add(1);
            reg.last_delivery_at = Some(timestamp.to_string());
        }
        drop(regs);
        self.persist_state().await;
    }

    /// Increment the failure counter for a registration.
    async fn increment_failure(&self, webhook_id: &str) {
        let mut regs = self.registrations.write().await;
        if let Some(reg) = regs.get_mut(webhook_id) {
            reg.failure_count = reg.failure_count.saturating_add(1);
            reg.last_delivery_at = Some(Utc::now().to_rfc3339());
        }
        drop(regs);
        self.persist_state().await;
    }

    /// Trim the delivery log to prevent unbounded memory growth.
    async fn trim_delivery_log(&self) {
        let mut log = self.delivery_log.write().await;
        if log.len() > MAX_DELIVERY_LOG {
            // Find the oldest entries and remove them
            let mut entries: Vec<(String, String)> = log
                .iter()
                .map(|(id, record)| (id.clone(), record.created_at.clone()))
                .collect();
            entries.sort_by(|a, b| a.1.cmp(&b.1));

            let to_remove = log.len().saturating_sub(MAX_DELIVERY_LOG);
            for (id, _) in entries.into_iter().take(to_remove) {
                log.remove(&id);
            }
        }
        drop(log);
        self.persist_state().await;
    }

    async fn persist_state(&self) {
        let Some(store) = &self.store else {
            return;
        };

        let snapshot = {
            let registrations = self.registrations.read().await;
            let delivery_log = self.delivery_log.read().await;
            PersistedWebhookState {
                registrations: registrations.clone(),
                delivery_log: delivery_log.clone(),
            }
        };

        if let Err(e) = store.save(&snapshot) {
            tracing::error!(
                error = %e,
                path = %store.path().display(),
                "Failed to persist webhook state"
            );
        }
    }
}

/// Compute an HMAC-SHA256 signature for the given payload using the secret.
///
/// Returns the hex-encoded signature string prefixed with `sha256=`.
fn compute_hmac_signature(secret: &str, payload: &str) -> Result<String, AppError> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).map_err(|e| {
        AppError::Internal(format!("Failed to create HMAC instance: {e}"))
    })?;
    mac.update(payload.as_bytes());
    let result = mac.finalize();
    let signature = hex::encode(result.into_bytes());
    Ok(format!("sha256={signature}"))
}
