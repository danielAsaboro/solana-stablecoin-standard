//! Backend integration tests for the Solana Stablecoin Standard (SSS).
//!
//! Tests the REST API endpoints, webhook service, PDA derivation, instruction
//! builders, configured-service route behavior, and local persistence.
//! Most tests avoid requiring a live Solana validator, but the configured-path
//! coverage verifies the backend responds sanely when Solana services are wired.

use std::fs;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::Keypair;
use solana_sdk::signer::Signer;
use tower::ServiceExt;

use sss_backend::services::compliance::{
    ComplianceAction, ComplianceOperation, ComplianceService, ComplianceStatus,
};
use sss_backend::services::indexer::{IndexedEvent, IndexerService};
use sss_backend::services::mint_burn::{MintBurnService, OperationStatus};
use sss_backend::services::operator_snapshots::OperatorSnapshotService;
use sss_backend::services::webhook::{
    DeliveryRecord, DeliveryStatus, DispatchMetadata, WebhookPayload, WebhookService,
};
use sss_backend::solana::{self, SolanaContext};
use sss_backend::AppState;
use uuid::Uuid;

// ── Test Helpers ──────────────────────────────────────────────────────────

/// Create an AppState with no Solana configuration (webhook only).
fn unconfigured_state() -> AppState {
    AppState {
        mint_burn: None,
        compliance: None,
        indexer: None,
        webhook: Arc::new(WebhookService::new()),
        operator_snapshots: Arc::new(OperatorSnapshotService::new()),
        prometheus_handle: None,
    }
}

/// Build a test router without middleware layers.
fn test_app() -> axum::Router {
    sss_backend::build_router(unconfigured_state())
}

/// Build a test app with a shared webhook service for direct service access.
fn test_app_with_webhook() -> (axum::Router, Arc<WebhookService>) {
    let webhook = Arc::new(WebhookService::new());
    let state = AppState {
        mint_burn: None,
        compliance: None,
        indexer: None,
        webhook: Arc::clone(&webhook),
        operator_snapshots: Arc::new(OperatorSnapshotService::new()),
        prometheus_handle: None,
    };
    (sss_backend::build_router(state), webhook)
}

/// Create an AppState with Solana-backed services configured.
fn configured_state() -> AppState {
    let ctx = Arc::new(test_solana_context());
    AppState {
        mint_burn: Some(Arc::new(MintBurnService::new(Arc::clone(&ctx)))),
        compliance: Some(Arc::new(ComplianceService::new(Arc::clone(&ctx)))),
        indexer: Some(Arc::new(IndexerService::new(Arc::clone(&ctx)))),
        webhook: Arc::new(WebhookService::new()),
        operator_snapshots: Arc::new(OperatorSnapshotService::new()),
        prometheus_handle: None,
    }
}

/// Build a configured test router without middleware layers.
fn configured_test_app() -> axum::Router {
    sss_backend::build_router(configured_state())
}

fn configured_test_app_with_compliance_operations(
    operations: Vec<ComplianceOperation>,
) -> axum::Router {
    let ctx = Arc::new(test_solana_context());
    let path = temp_file_path("compliance-audit");
    let persisted = json!({
        "operations": operations
            .into_iter()
            .map(|operation| (operation.id.clone(), serde_json::to_value(operation).unwrap()))
            .collect::<serde_json::Map<String, Value>>(),
    });
    fs::write(&path, serde_json::to_vec_pretty(&persisted).unwrap()).unwrap();

    let state = AppState {
        mint_burn: Some(Arc::new(MintBurnService::new(Arc::clone(&ctx)))),
        compliance: Some(Arc::new(
            ComplianceService::with_persistence(Arc::clone(&ctx), &path).unwrap(),
        )),
        indexer: Some(Arc::new(IndexerService::new(Arc::clone(&ctx)))),
        webhook: Arc::new(WebhookService::new()),
        operator_snapshots: Arc::new(OperatorSnapshotService::new()),
        prometheus_handle: None,
    };

    sss_backend::build_router(state)
}

fn configured_test_app_with_timeline_data(
    operations: Vec<ComplianceOperation>,
    events: Vec<IndexedEvent>,
    deliveries: Vec<DeliveryRecord>,
) -> axum::Router {
    let ctx = Arc::new(test_solana_context());
    let compliance_path = temp_file_path("timeline-compliance");
    let indexer_path = temp_file_path("timeline-indexer");
    let webhook_path = temp_file_path("timeline-webhook");

    let compliance_state = json!({
        "operations": operations
            .into_iter()
            .map(|operation| (operation.id.clone(), serde_json::to_value(operation).unwrap()))
            .collect::<serde_json::Map<String, Value>>(),
    });
    let indexer_state = json!({
        "events": events,
        "last_signature": null
    });
    let webhook_state = json!({
        "registrations": {},
        "delivery_log": deliveries
            .into_iter()
            .map(|delivery| (delivery.id.clone(), serde_json::to_value(delivery).unwrap()))
            .collect::<serde_json::Map<String, Value>>(),
    });

    fs::write(&compliance_path, serde_json::to_vec_pretty(&compliance_state).unwrap()).unwrap();
    fs::write(&indexer_path, serde_json::to_vec_pretty(&indexer_state).unwrap()).unwrap();
    fs::write(&webhook_path, serde_json::to_vec_pretty(&webhook_state).unwrap()).unwrap();

    let state = AppState {
        mint_burn: Some(Arc::new(MintBurnService::new(Arc::clone(&ctx)))),
        compliance: Some(Arc::new(
            ComplianceService::with_persistence(Arc::clone(&ctx), &compliance_path).unwrap(),
        )),
        indexer: Some(Arc::new(
            IndexerService::with_persistence(Arc::clone(&ctx), &indexer_path).unwrap(),
        )),
        webhook: Arc::new(WebhookService::with_persistence(&webhook_path).unwrap()),
        operator_snapshots: Arc::new(OperatorSnapshotService::new()),
        prometheus_handle: None,
    };

    sss_backend::build_router(state)
}

/// Send a GET request and return (status, body_json).
async fn get_json(app: axum::Router, uri: &str) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
    (status, json)
}

/// Send a GET request and return (status, body_text, content_type).
async fn get_text(app: axum::Router, uri: &str) -> (StatusCode, String, Option<String>) {
    let response = app
        .oneshot(
            Request::builder()
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    (status, String::from_utf8(body.to_vec()).unwrap(), content_type)
}

/// Send a POST request with JSON body and return (status, body_json).
async fn post_json(app: axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("Content-Type", "application/json")
                .body(Body::from(serde_json::to_string(&body).unwrap()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

/// Send a POST request with no body and return (status, body_json).
async fn post_empty(app: axum::Router, uri: &str) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

/// Send a DELETE request and return (status, body_json).
async fn delete_json(app: axum::Router, uri: &str) -> (StatusCode, Value) {
    let response = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json)
}

/// Create a test SolanaContext with a random keypair (no real RPC connection).
fn test_solana_context() -> SolanaContext {
    let keypair = Keypair::new();
    let program_id =
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap();
    let mint = Pubkey::new_unique();
    SolanaContext::new("http://localhost:8899", program_id, mint, keypair)
}

fn temp_file_path(prefix: &str) -> String {
    let dir = std::env::temp_dir().join(format!("sss-backend-{prefix}-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir.join("state.json").display().to_string()
}

// ══════════════════════════════════════════════════════════════════════════
//  HEALTH ENDPOINT
// ══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_health_check_returns_ok() {
    let (status, json) = get_json(test_app(), "/health").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["status"], "healthy");
    assert!(!json["version"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn test_health_reports_no_solana_configured() {
    let (_, json) = get_json(test_app(), "/health").await;
    assert_eq!(json["solana_configured"], false);
    assert_eq!(json["services"]["mint_burn"], false);
    assert_eq!(json["services"]["compliance"], false);
    assert_eq!(json["services"]["indexer"], false);
}

#[tokio::test]
async fn test_health_reports_webhooks_always_available() {
    let (_, json) = get_json(test_app(), "/health").await;
    assert_eq!(json["services"]["webhooks"], true);
}

#[tokio::test]
async fn test_health_reports_solana_services_when_configured() {
    let (_, json) = get_json(configured_test_app(), "/health").await;
    assert_eq!(json["solana_configured"], true);
    assert_eq!(json["services"]["mint_burn"], true);
    assert_eq!(json["services"]["compliance"], true);
    assert_eq!(json["services"]["indexer"], true);
}

// ══════════════════════════════════════════════════════════════════════════
//  WEBHOOK CRUD ROUTES
// ══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_register_webhook() {
    let (status, json) = post_json(
        test_app(),
        "/api/v1/webhooks",
        json!({
            "url": "https://example.com/hook",
            "events": ["TokensMinted"],
            "secret": "my-secret"
        }),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(!json["id"].as_str().unwrap().is_empty());
    assert_eq!(json["url"], "https://example.com/hook");
    assert_eq!(json["events"][0], "TokensMinted");
    assert_eq!(json["active"], true);
    assert_eq!(json["delivery_count"], 0);
    assert_eq!(json["failure_count"], 0);
    assert_eq!(json["signing_enabled"], true);
    assert_eq!(json["signature_header"], "X-SSS-Signature");
    assert_eq!(json["signature_algorithm"], "HMAC-SHA256");
}

#[tokio::test]
async fn test_register_webhook_empty_url() {
    let (status, json) = post_json(
        test_app(),
        "/api/v1/webhooks",
        json!({ "url": "", "events": [] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(json["error"].as_str().unwrap().contains("url is required"));
}

#[tokio::test]
async fn test_register_webhook_invalid_url_scheme() {
    let (status, json) = post_json(
        test_app(),
        "/api/v1/webhooks",
        json!({ "url": "ftp://example.com", "events": [] }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(json["error"]
        .as_str()
        .unwrap()
        .contains("http:// or https://"));
}

#[tokio::test]
async fn test_list_webhooks_empty() {
    let (status, json) = get_json(test_app(), "/api/v1/webhooks").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_list_webhooks_after_registration() {
    let (app, webhook) = test_app_with_webhook();

    // Register a webhook directly via the shared service
    webhook
        .register(
            "https://example.com/hook".to_string(),
            vec!["TokensMinted".to_string()],
            None,
        )
        .await;

    let (status, json) = get_json(app, "/api/v1/webhooks").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
    assert_eq!(json[0]["url"], "https://example.com/hook");
    assert_eq!(json[0]["signing_enabled"], false);
}

#[tokio::test]
async fn test_get_webhook_by_id() {
    let (app, webhook) = test_app_with_webhook();

    let reg = webhook
        .register("https://example.com/hook".to_string(), vec![], None)
        .await;

    let (status, json) = get_json(app, &format!("/api/v1/webhooks/{}", reg.id)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["id"], reg.id);
    assert_eq!(json["url"], "https://example.com/hook");
    assert_eq!(json["signing_enabled"], false);
}

#[tokio::test]
async fn test_get_webhook_not_found() {
    let (status, json) = get_json(test_app(), "/api/v1/webhooks/nonexistent-id").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["code"], "NOT_FOUND");
}

#[tokio::test]
async fn test_delete_webhook() {
    let (app, webhook) = test_app_with_webhook();

    let reg = webhook
        .register("https://example.com/hook".to_string(), vec![], None)
        .await;

    let (status, json) = delete_json(app, &format!("/api/v1/webhooks/{}", reg.id)).await;
    assert_eq!(status, StatusCode::OK);
    assert!(json["message"].as_str().unwrap().contains("unregistered"));

    // Verify it's gone
    assert!(webhook.get_registration(&reg.id).await.is_none());
}

#[tokio::test]
async fn test_delete_webhook_not_found() {
    let (status, json) = delete_json(test_app(), "/api/v1/webhooks/nonexistent-id").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(json["code"], "NOT_FOUND");
}

// ══════════════════════════════════════════════════════════════════════════
//  WEBHOOK DELIVERY & DISPATCH
// ══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_webhook_delivery_log_initially_empty() {
    let (status, json) = get_json(test_app(), "/api/v1/webhooks/deliveries").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_webhook_dispatch_creates_delivery_record() {
    let signature = "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ".to_string();
    let correlation_id = format!("tx:{signature}");
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::body_partial_json(json!({
            "event_type": "TokensMinted",
            "correlation_id": correlation_id.clone(),
            "transaction_signature": signature.clone(),
            "event_id": "event-1"
        })))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    let webhook = Arc::new(WebhookService::new());
    let state = AppState {
        mint_burn: None,
        compliance: None,
        indexer: None,
        webhook: Arc::clone(&webhook),
        operator_snapshots: Arc::new(OperatorSnapshotService::new()),
        prometheus_handle: None,
    };
    let app = sss_backend::build_router(state);
    webhook
        .register(mock_server.uri(), vec![], None)
        .await;

    webhook
        .dispatch_event_with_context(
            "TokensMinted",
            json!({"amount": 1000}),
            DispatchMetadata {
                correlation_id: Some(correlation_id.clone()),
                transaction_signature: Some(signature.clone()),
                event_id: Some("event-1".to_string()),
            },
        )
        .await;

    // Wait for delivery to complete
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let log = webhook.get_delivery_log(100).await;
        if !log.is_empty() && log.iter().all(|r| r.status != DeliveryStatus::Pending) {
            assert_eq!(log[0].status, DeliveryStatus::Delivered);
            assert_eq!(log[0].event_type, "TokensMinted");
            assert_eq!(log[0].attempts, 1);
            assert_eq!(log[0].correlation_id.as_deref(), Some(correlation_id.as_str()));
            assert_eq!(log[0].transaction_signature.as_deref(), Some(signature.as_str()));
            assert_eq!(log[0].event_id.as_deref(), Some("event-1"));
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("Delivery did not complete within 5 seconds");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let (status, json) = get_json(app, "/api/v1/webhooks/deliveries").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 1);
    assert_eq!(json[0]["status"], "delivered");
    assert_eq!(json[0]["retry_scheduled"], false);
    assert_eq!(json[0]["finalized"], true);
    assert_eq!(json[0]["max_attempts"], 3);
    assert_eq!(json[0]["correlation_id"], correlation_id);
    assert_eq!(json[0]["transaction_signature"], signature);
    assert_eq!(json[0]["event_id"], "event-1");
}

#[tokio::test]
async fn test_webhook_hmac_signature_header_present() {
    let mock_server = wiremock::MockServer::start().await;

    // Verify the HMAC signature header is present when secret is set
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .and(wiremock::matchers::header_exists("X-SSS-Signature"))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .expect(1)
        .mount(&mock_server)
        .await;

    let webhook = Arc::new(WebhookService::new());
    webhook
        .register(
            mock_server.uri(),
            vec![],
            Some("test-secret-key".to_string()),
        )
        .await;

    webhook
        .dispatch_event("TokensBurned", json!({"amount": 500}))
        .await;

    // Wait for delivery
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let log = webhook.get_delivery_log(100).await;
        if !log.is_empty() && log.iter().all(|r| r.status != DeliveryStatus::Pending) {
            assert_eq!(log[0].status, DeliveryStatus::Delivered);
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("Delivery did not complete within 5 seconds");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // Verify mock received exactly 1 request with the X-SSS-Signature header
    mock_server.verify().await;
}

#[tokio::test]
async fn test_webhook_delivery_can_be_replayed() {
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .expect(2)
        .mount(&mock_server)
        .await;

    let webhook = Arc::new(WebhookService::new());
    let state = AppState {
        mint_burn: None,
        compliance: None,
        indexer: None,
        webhook: Arc::clone(&webhook),
        operator_snapshots: Arc::new(OperatorSnapshotService::new()),
        prometheus_handle: None,
    };
    let app = sss_backend::build_router(state);
    webhook.register(mock_server.uri(), vec![], None).await;

    webhook
        .dispatch_event_with_context(
            "TokensMinted",
            json!({"amount": 1000}),
            DispatchMetadata {
                correlation_id: Some("tx:replayable".to_string()),
                transaction_signature: Some("replayable".to_string()),
                event_id: Some("event-replay".to_string()),
            },
        )
        .await;

    let original_delivery_id = loop {
        let log = webhook.get_delivery_log(100).await;
        if let Some(record) = log.first() {
            if record.status != DeliveryStatus::Pending {
                break record.id.clone();
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    };

    let (status, json) = post_empty(
        app,
        &format!("/api/v1/webhooks/deliveries/{original_delivery_id}/redeliver"),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(json["replayed_from"], original_delivery_id);

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let log = webhook.get_delivery_log(100).await;
        if log.len() >= 2 && log.iter().all(|record| record.status != DeliveryStatus::Pending) {
            assert!(log.iter().any(|record| record.replayed_from == Some(original_delivery_id.clone())));
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("Replay delivery did not complete within 5 seconds");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    mock_server.verify().await;
}

#[tokio::test]
async fn test_webhook_event_filtering_blocks_non_matching() {
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .expect(0) // Should NOT be called
        .mount(&mock_server)
        .await;

    let webhook = Arc::new(WebhookService::new());
    // Register only for TokensMinted events
    webhook
        .register(
            mock_server.uri(),
            vec!["TokensMinted".to_string()],
            None,
        )
        .await;

    // Dispatch a different event type — should not match
    webhook
        .dispatch_event("TokensBurned", json!({"amount": 100}))
        .await;

    // Give time to (not) process
    tokio::time::sleep(Duration::from_millis(500)).await;

    // No deliveries should exist
    let log = webhook.get_delivery_log(100).await;
    assert_eq!(
        log.len(),
        0,
        "Webhook should not receive non-matching events"
    );
}

#[tokio::test]
async fn test_webhook_client_error_no_retry() {
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(404))
        .expect(1) // Only 1 attempt — no retries for 4xx
        .mount(&mock_server)
        .await;

    let webhook = Arc::new(WebhookService::new());
    webhook.register(mock_server.uri(), vec![], None).await;

    webhook
        .dispatch_event("StablecoinPaused", json!({}))
        .await;

    // Wait for delivery (fast — no retries for 4xx)
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let log = webhook.get_delivery_log(100).await;
        if !log.is_empty() && log.iter().all(|r| r.status != DeliveryStatus::Pending) {
            assert_eq!(log[0].status, DeliveryStatus::Failed);
            assert_eq!(log[0].attempts, 1);
            assert_eq!(log[0].response_code, Some(404));
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("Delivery did not complete within 5 seconds");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // Verify mock received exactly 1 request
    mock_server.verify().await;
}

#[tokio::test]
async fn test_webhook_server_error_retries_then_fails() {
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(500))
        .mount(&mock_server)
        .await;

    let webhook = Arc::new(WebhookService::new());
    webhook.register(mock_server.uri(), vec![], None).await;

    webhook
        .dispatch_event("AccountFrozen", json!({}))
        .await;

    // Wait for retries to exhaust (3 retries with backoff: ~7s total)
    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    loop {
        let log = webhook.get_delivery_log(100).await;
        if !log.is_empty() && log.iter().all(|r| r.status == DeliveryStatus::Failed) {
            assert_eq!(log[0].status, DeliveryStatus::Failed);
            assert!(
                log[0].attempts >= 3,
                "Expected at least 3 attempts, got {}",
                log[0].attempts
            );
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("Delivery retries did not exhaust within 15 seconds");
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

// ══════════════════════════════════════════════════════════════════════════
//  SERVICE UNAVAILABLE (NO SOLANA CONFIGURED)
// ══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_mint_returns_503_without_solana() {
    let (status, json) = post_json(
        test_app(),
        "/api/v1/mint",
        json!({"recipient": "11111111111111111111111111111111", "amount": 1000}),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_burn_returns_503_without_solana() {
    let (status, json) = post_json(
        test_app(),
        "/api/v1/burn",
        json!({"from_account": "11111111111111111111111111111111", "amount": 1000}),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_operations_list_returns_503_without_solana() {
    let (status, json) = get_json(test_app(), "/api/v1/operations").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_operations_get_returns_503_without_solana() {
    let (status, json) = get_json(test_app(), "/api/v1/operations/some-id").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_info_returns_503_without_solana() {
    let (status, json) = get_json(test_app(), "/api/v1/info").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_blacklist_post_returns_503_without_solana() {
    let (status, json) = post_json(
        test_app(),
        "/api/v1/blacklist",
        json!({"address": "11111111111111111111111111111111", "reason": "test"}),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_blacklist_list_returns_503_without_solana() {
    let (status, json) = get_json(test_app(), "/api/v1/blacklist").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_blacklist_check_returns_503_without_solana() {
    let (status, json) = get_json(
        test_app(),
        "/api/v1/blacklist/11111111111111111111111111111111",
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_blacklist_delete_returns_503_without_solana() {
    let (status, json) = delete_json(
        test_app(),
        "/api/v1/blacklist/11111111111111111111111111111111",
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_audit_returns_503_without_solana() {
    let (status, json) = get_json(test_app(), "/api/v1/audit").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_events_returns_503_without_solana() {
    let (status, json) = get_json(test_app(), "/api/v1/events").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_events_count_returns_503_without_solana() {
    let (status, json) = get_json(test_app(), "/api/v1/events/count").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

#[tokio::test]
async fn test_events_status_returns_503_without_solana() {
    let (status, json) = get_json(test_app(), "/api/v1/events/status").await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(json["code"], "NOT_CONFIGURED");
}

// ══════════════════════════════════════════════════════════════════════════
//  CONFIGURED SERVICE ROUTES
// ══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_info_returns_metadata_when_configured() {
    let (status, json) = get_json(configured_test_app(), "/api/v1/info").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json["program_id"], "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu");
    assert!(!json["service_pubkey"].as_str().unwrap().is_empty());
    assert!(!json["config_address"].as_str().unwrap().is_empty());
}

#[tokio::test]
async fn test_operations_list_returns_empty_when_configured() {
    let (status, json) = get_json(configured_test_app(), "/api/v1/operations").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_blacklist_and_audit_return_empty_when_configured() {
    let (status, blacklist_json) = get_json(configured_test_app(), "/api/v1/blacklist").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(blacklist_json.as_array().unwrap().len(), 0);

    let (status, audit_json) = get_json(configured_test_app(), "/api/v1/audit").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(audit_json.as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn test_audit_supports_jsonl_export() {
    let app = configured_test_app_with_compliance_operations(vec![ComplianceOperation {
        id: "audit-op-1".to_string(),
        action: ComplianceAction::Blacklist,
        address: "11111111111111111111111111111111".to_string(),
        reason: Some("Manual review".to_string()),
        status: ComplianceStatus::Completed,
        signature: Some("4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ".to_string()),
        error: None,
        created_at: "2026-03-12T10:00:00Z".to_string(),
        completed_at: Some("2026-03-12T10:01:00Z".to_string()),
        authority: "4Nd1mY4bP9RTpV1ZVYzX4t1f34Fq3KZgY7uTW6R1YB3R".to_string(),
    }]);

    let (status, body, content_type) = get_text(app, "/api/v1/audit?format=jsonl").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type.as_deref(), Some("application/x-ndjson"));

    let lines = body.lines().collect::<Vec<_>>();
    assert_eq!(lines.len(), 1);

    let record: Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(record["action"], "blacklist");
    assert_eq!(record["event_type"], "compliance.blacklist");
    assert_eq!(record["severity"], "info");
    assert_eq!(record["target_address"], "11111111111111111111111111111111");
    assert_eq!(record["signature"], "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ");
    assert_eq!(record["timestamp"], "2026-03-12T10:01:00Z");
}

#[tokio::test]
async fn test_indexer_routes_return_empty_when_configured() {
    let (status, events_json) = get_json(configured_test_app(), "/api/v1/events").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(events_json.as_array().unwrap().len(), 0);

    let (status, count_json) = get_json(configured_test_app(), "/api/v1/events/count").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(count_json["count"], 0);

    let (status, status_json) =
        get_json(configured_test_app(), "/api/v1/events/status").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(status_json["total_events"], 0);
    assert_eq!(
        status_json["program_id"],
        "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
    );
}

#[tokio::test]
async fn test_operator_timeline_groups_tx_correlated_records() {
    let signature = "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ".to_string();
    let correlation_id = format!("tx:{signature}");
    let app = configured_test_app_with_timeline_data(
        vec![ComplianceOperation {
            id: "compliance-op-1".to_string(),
            action: ComplianceAction::Blacklist,
            address: "11111111111111111111111111111111".to_string(),
            reason: Some("Manual review".to_string()),
            status: ComplianceStatus::Completed,
            signature: Some(signature.clone()),
            error: None,
            created_at: "2026-03-12T10:00:00Z".to_string(),
            completed_at: Some("2026-03-12T10:01:00Z".to_string()),
            authority: "4Nd1mY4bP9RTpV1ZVYzX4t1f34Fq3KZgY7uTW6R1YB3R".to_string(),
        }],
        vec![IndexedEvent {
            id: "event-1".to_string(),
            event_type: "AddressBlacklisted".to_string(),
            signature: signature.clone(),
            slot: 42,
            timestamp: Some(1_710_237_660),
            data: json!({
                "address": "11111111111111111111111111111111",
                "blacklisted_by": "4Nd1mY4bP9RTpV1ZVYzX4t1f34Fq3KZgY7uTW6R1YB3R"
            }),
            indexed_at: "2026-03-12T10:01:01Z".to_string(),
        }],
        vec![DeliveryRecord {
            id: "delivery-1".to_string(),
            webhook_id: "webhook-1".to_string(),
            event_type: "AddressBlacklisted".to_string(),
            correlation_id: Some(correlation_id.clone()),
            transaction_signature: Some(signature.clone()),
            event_id: Some("event-1".to_string()),
            replayed_from: None,
            status: DeliveryStatus::Delivered,
            attempts: 1,
            last_attempt_at: Some("2026-03-12T10:01:05Z".to_string()),
            response_code: Some(200),
            error: None,
            created_at: "2026-03-12T10:01:04Z".to_string(),
            payload: WebhookPayload {
                id: "delivery-1".to_string(),
                event_type: "AddressBlacklisted".to_string(),
                timestamp: "2026-03-12T10:01:04Z".to_string(),
                correlation_id: Some(correlation_id.clone()),
                transaction_signature: Some(signature.clone()),
                event_id: Some("event-1".to_string()),
                data: json!({"address": "11111111111111111111111111111111"}),
            },
        }],
    );

    let (status, json) = get_json(app, "/api/v1/operator-timeline?limit=10").await;
    assert_eq!(status, StatusCode::OK);
    let incidents = json.as_array().unwrap();
    assert_eq!(incidents.len(), 1);
    assert_eq!(incidents[0]["id"], correlation_id);
    assert_eq!(incidents[0]["action"], "blacklist.add");
    assert_eq!(incidents[0]["status"], "restricted");
    assert_eq!(incidents[0]["related_count"], 3);
    assert_eq!(incidents[0]["sources"].as_array().unwrap().len(), 3);
    assert_eq!(incidents[0]["sources"][0], "indexer");
    assert_eq!(incidents[0]["sources"][1], "compliance");
    assert_eq!(incidents[0]["sources"][2], "webhook");
}

#[tokio::test]
async fn test_operator_timeline_filters_by_source() {
    let app = configured_test_app_with_timeline_data(
        Vec::new(),
        vec![IndexedEvent {
            id: "event-1".to_string(),
            event_type: "TokensMinted".to_string(),
            signature: "5JtW4LT9JzwzGW2bmmXVQy2Ksxx6a1o3GKpLfQYrK6KXznz5U".to_string(),
            slot: 7,
            timestamp: Some(1_710_237_660),
            data: json!({ "recipient": "11111111111111111111111111111111" }),
            indexed_at: "2026-03-12T10:01:01Z".to_string(),
        }],
        vec![DeliveryRecord {
            id: "delivery-1".to_string(),
            webhook_id: "webhook-1".to_string(),
            event_type: "TokensMinted".to_string(),
            correlation_id: Some("tx:5JtW4LT9JzwzGW2bmmXVQy2Ksxx6a1o3GKpLfQYrK6KXznz5U".to_string()),
            transaction_signature: Some(
                "5JtW4LT9JzwzGW2bmmXVQy2Ksxx6a1o3GKpLfQYrK6KXznz5U".to_string(),
            ),
            event_id: Some("event-1".to_string()),
            replayed_from: None,
            status: DeliveryStatus::Failed,
            attempts: 3,
            last_attempt_at: Some("2026-03-12T10:01:05Z".to_string()),
            response_code: Some(500),
            error: Some("Exhausted retries".to_string()),
            created_at: "2026-03-12T10:01:04Z".to_string(),
            payload: WebhookPayload {
                id: "delivery-1".to_string(),
                event_type: "TokensMinted".to_string(),
                timestamp: "2026-03-12T10:01:04Z".to_string(),
                correlation_id: Some("tx:5JtW4LT9JzwzGW2bmmXVQy2Ksxx6a1o3GKpLfQYrK6KXznz5U".to_string()),
                transaction_signature: Some(
                    "5JtW4LT9JzwzGW2bmmXVQy2Ksxx6a1o3GKpLfQYrK6KXznz5U".to_string(),
                ),
                event_id: Some("event-1".to_string()),
                data: json!({"recipient": "11111111111111111111111111111111"}),
            },
        }],
    );

    let (status, json) = get_json(app, "/api/v1/operator-timeline?source=webhook").await;
    assert_eq!(status, StatusCode::OK);
    let incidents = json.as_array().unwrap();
    assert_eq!(incidents.len(), 1);
    assert_eq!(incidents[0]["sources"][0], "webhook");
    assert_eq!(incidents[0]["severity"], "critical");
}

#[tokio::test]
async fn test_operator_timeline_supports_jsonl_export() {
    let signature = "4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ".to_string();
    let app = configured_test_app_with_timeline_data(
        Vec::new(),
        vec![IndexedEvent {
            id: "event-1".to_string(),
            event_type: "TokensMinted".to_string(),
            signature: signature.clone(),
            slot: 42,
            timestamp: Some(1_710_237_660),
            data: json!({
                "recipient": "11111111111111111111111111111111",
                "minter": "4Nd1mY4bP9RTpV1ZVYzX4t1f34Fq3KZgY7uTW6R1YB3R"
            }),
            indexed_at: "2026-03-12T10:01:01Z".to_string(),
        }],
        Vec::new(),
    );

    let (status, body, content_type) =
        get_text(app, "/api/v1/operator-timeline?format=jsonl&limit=5").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(content_type.as_deref(), Some("application/x-ndjson"));

    let lines = body.lines().collect::<Vec<_>>();
    assert_eq!(lines.len(), 1);
    let incident: Value = serde_json::from_str(lines[0]).unwrap();
    assert_eq!(incident["id"], format!("tx:{signature}"));
    assert_eq!(incident["action"], "mint");
}

#[tokio::test]
async fn test_operator_snapshots_create_and_diff() {
    let state = AppState {
        mint_burn: None,
        compliance: None,
        indexer: None,
        webhook: Arc::new(WebhookService::new()),
        operator_snapshots: Arc::new(OperatorSnapshotService::new()),
        prometheus_handle: None,
    };
    let app = sss_backend::build_router(state);

    let (created_status, first_snapshot) = post_json(
        app.clone(),
        "/api/v1/operator-snapshots",
        json!({"label": "before"}),
    )
    .await;
    assert_eq!(created_status, StatusCode::CREATED);
    assert!(first_snapshot["summary"]["paused"].is_null());
    assert!(first_snapshot["summary"]["role_count"].is_null());
    assert!(first_snapshot["summary"]["minter_count"].is_null());
    assert!(first_snapshot["summary"]["blacklist_count"].is_null());

    let (created_status, second_snapshot) = post_json(
        app.clone(),
        "/api/v1/operator-snapshots",
        json!({"label": "after"}),
    )
    .await;
    assert_eq!(created_status, StatusCode::CREATED);

    let (status, diff) = get_json(
        app,
        &format!(
            "/api/v1/operator-snapshots/diff?from={}&to={}",
            first_snapshot["id"].as_str().unwrap(),
            second_snapshot["id"].as_str().unwrap()
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(diff["from_snapshot_id"], first_snapshot["id"]);
    assert_eq!(diff["to_snapshot_id"], second_snapshot["id"]);
    assert!(diff["changes"]["live_supply_delta"].is_null());
    assert!(diff["changes"]["role_count_delta"].is_null());
}

// ══════════════════════════════════════════════════════════════════════════
//  PDA DERIVATION
// ══════════════════════════════════════════════════════════════════════════

#[test]
fn test_config_pda_derivation_deterministic() {
    let program_id =
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap();
    let mint = Pubkey::new_unique();

    let (pda1, bump1) = solana::derive_config_pda(&mint, &program_id);
    let (pda2, bump2) = solana::derive_config_pda(&mint, &program_id);

    assert_eq!(pda1, pda2, "Same inputs must produce same PDA");
    assert_eq!(bump1, bump2, "Same inputs must produce same bump");

    // Different mint should produce a different PDA
    let mint2 = Pubkey::new_unique();
    let (pda3, _) = solana::derive_config_pda(&mint2, &program_id);
    assert_ne!(pda1, pda3, "Different mints must produce different PDAs");
}

#[test]
fn test_role_pda_different_role_types_produce_different_pdas() {
    let program_id =
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap();
    let config = Pubkey::new_unique();
    let user = Pubkey::new_unique();

    // Each role type should produce a unique PDA
    let (minter_pda, _) = solana::derive_role_pda(&config, 0, &user, &program_id);
    let (burner_pda, _) = solana::derive_role_pda(&config, 1, &user, &program_id);
    let (pauser_pda, _) = solana::derive_role_pda(&config, 2, &user, &program_id);
    let (blacklister_pda, _) = solana::derive_role_pda(&config, 3, &user, &program_id);
    let (seizer_pda, _) = solana::derive_role_pda(&config, 4, &user, &program_id);

    let pdas = [
        minter_pda,
        burner_pda,
        pauser_pda,
        blacklister_pda,
        seizer_pda,
    ];
    for i in 0..pdas.len() {
        for j in (i + 1)..pdas.len() {
            assert_ne!(
                pdas[i], pdas[j],
                "Role PDAs for types {} and {} should differ",
                i, j
            );
        }
    }
}

#[test]
fn test_role_pda_different_users_produce_different_pdas() {
    let program_id =
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap();
    let config = Pubkey::new_unique();
    let user1 = Pubkey::new_unique();
    let user2 = Pubkey::new_unique();

    let (pda1, _) = solana::derive_role_pda(&config, 0, &user1, &program_id);
    let (pda2, _) = solana::derive_role_pda(&config, 0, &user2, &program_id);

    assert_ne!(pda1, pda2, "Different users must produce different role PDAs");
}

#[test]
fn test_minter_quota_pda_derivation() {
    let program_id =
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap();
    let config = Pubkey::new_unique();
    let minter = Pubkey::new_unique();

    let (pda1, bump1) = solana::derive_minter_quota_pda(&config, &minter, &program_id);
    let (pda2, bump2) = solana::derive_minter_quota_pda(&config, &minter, &program_id);

    assert_eq!(pda1, pda2);
    assert_eq!(bump1, bump2);

    // Different minter should produce different PDA
    let minter2 = Pubkey::new_unique();
    let (pda3, _) = solana::derive_minter_quota_pda(&config, &minter2, &program_id);
    assert_ne!(pda1, pda3);
}

#[test]
fn test_blacklist_pda_derivation() {
    let program_id =
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap();
    let config = Pubkey::new_unique();
    let addr = Pubkey::new_unique();

    let (pda1, bump1) = solana::derive_blacklist_pda(&config, &addr, &program_id);
    let (pda2, bump2) = solana::derive_blacklist_pda(&config, &addr, &program_id);

    assert_eq!(pda1, pda2);
    assert_eq!(bump1, bump2);

    // Different address should produce different PDA
    let addr2 = Pubkey::new_unique();
    let (pda3, _) = solana::derive_blacklist_pda(&config, &addr2, &program_id);
    assert_ne!(pda1, pda3);
}

#[test]
fn test_ata_derivation_deterministic() {
    let wallet = Pubkey::new_unique();
    let mint = Pubkey::new_unique();

    let ata1 = solana::get_associated_token_address(&wallet, &mint);
    let ata2 = solana::get_associated_token_address(&wallet, &mint);

    assert_eq!(ata1, ata2, "Same inputs must produce same ATA");

    // Different wallet should produce different ATA
    let wallet2 = Pubkey::new_unique();
    let ata3 = solana::get_associated_token_address(&wallet2, &mint);
    assert_ne!(ata1, ata3, "Different wallets must produce different ATAs");
}

// ══════════════════════════════════════════════════════════════════════════
//  INSTRUCTION BUILDERS
// ══════════════════════════════════════════════════════════════════════════

#[test]
fn test_mint_instruction_structure() {
    let ctx = test_solana_context();
    let recipient_ata = Pubkey::new_unique();
    let amount: u64 = 1_000_000;

    let ix = solana::build_mint_instruction(&ctx, &recipient_ata, amount);

    // Verify program_id
    assert_eq!(ix.program_id, ctx.program_id);

    // Verify 7 accounts
    assert_eq!(ix.accounts.len(), 7, "Mint instruction must have 7 accounts");

    // Account 0: minter (signer, readonly)
    assert_eq!(ix.accounts[0].pubkey, ctx.keypair.pubkey());
    assert!(ix.accounts[0].is_signer);

    // Account 1: config PDA (writable)
    assert_eq!(ix.accounts[1].pubkey, ctx.config_pda);
    assert!(ix.accounts[1].is_writable);

    // Account 4: mint (writable)
    assert_eq!(ix.accounts[4].pubkey, ctx.mint);
    assert!(ix.accounts[4].is_writable);

    // Account 5: recipient ATA (writable)
    assert_eq!(ix.accounts[5].pubkey, recipient_ata);
    assert!(ix.accounts[5].is_writable);

    // Verify data: 8-byte discriminator + 8-byte amount (little-endian)
    assert_eq!(ix.data.len(), 16, "Mint data must be 16 bytes");
    let amount_bytes: [u8; 8] = ix.data[8..16].try_into().unwrap();
    assert_eq!(u64::from_le_bytes(amount_bytes), amount);
}

#[test]
fn test_burn_instruction_structure() {
    let ctx = test_solana_context();
    let from_account = Pubkey::new_unique();
    let amount: u64 = 500_000;

    let ix = solana::build_burn_instruction(&ctx, &from_account, amount);

    // Verify program_id
    assert_eq!(ix.program_id, ctx.program_id);

    // Verify 6 accounts
    assert_eq!(ix.accounts.len(), 6, "Burn instruction must have 6 accounts");

    // Account 0: burner (signer)
    assert_eq!(ix.accounts[0].pubkey, ctx.keypair.pubkey());
    assert!(ix.accounts[0].is_signer);

    // Account 1: config PDA (writable)
    assert_eq!(ix.accounts[1].pubkey, ctx.config_pda);
    assert!(ix.accounts[1].is_writable);

    // Account 3: mint (writable)
    assert_eq!(ix.accounts[3].pubkey, ctx.mint);
    assert!(ix.accounts[3].is_writable);

    // Account 4: from_token_account (writable)
    assert_eq!(ix.accounts[4].pubkey, from_account);
    assert!(ix.accounts[4].is_writable);

    // Verify data: 8-byte discriminator + 8-byte amount (little-endian)
    assert_eq!(ix.data.len(), 16, "Burn data must be 16 bytes");
    let amount_bytes: [u8; 8] = ix.data[8..16].try_into().unwrap();
    assert_eq!(u64::from_le_bytes(amount_bytes), amount);
}

#[test]
fn test_add_blacklist_instruction_data_encoding() {
    let ctx = test_solana_context();
    let address = Pubkey::new_unique();
    let reason = "OFAC sanctions match";

    let ix = solana::build_add_to_blacklist_instruction(&ctx, &address, reason, [0u8; 32], "");

    // Verify program_id
    assert_eq!(ix.program_id, ctx.program_id);

    // Verify 5 accounts
    assert_eq!(
        ix.accounts.len(),
        5,
        "Blacklist add instruction must have 5 accounts"
    );

    // Account 0: authority (signer, writable — pays rent for PDA creation)
    assert_eq!(ix.accounts[0].pubkey, ctx.keypair.pubkey());
    assert!(ix.accounts[0].is_signer);
    assert!(ix.accounts[0].is_writable);

    // Verify data: discriminator(8) + address(32) + reason_len(4) + reason(var) + evidence_hash(32) + evidence_uri_len(4) + evidence_uri(var)
    let expected_len = 8 + 32 + 4 + reason.len() + 32 + 4;
    assert_eq!(ix.data.len(), expected_len);

    // Verify address bytes in data
    assert_eq!(&ix.data[8..40], address.as_ref());

    // Verify reason length (little-endian u32)
    let reason_len = u32::from_le_bytes(ix.data[40..44].try_into().unwrap());
    assert_eq!(reason_len as usize, reason.len());

    // Verify reason bytes
    let reason_end = 44 + reason.len();
    assert_eq!(&ix.data[44..reason_end], reason.as_bytes());

    // Verify evidence_hash (32 zero bytes)
    assert_eq!(&ix.data[reason_end..reason_end + 32], &[0u8; 32]);

    // Verify evidence_uri length (0)
    let uri_len = u32::from_le_bytes(ix.data[reason_end + 32..reason_end + 36].try_into().unwrap());
    assert_eq!(uri_len, 0);
}

#[test]
fn test_remove_blacklist_instruction_data_encoding() {
    let ctx = test_solana_context();
    let address = Pubkey::new_unique();

    let ix = solana::build_remove_from_blacklist_instruction(&ctx, &address);

    // Verify program_id
    assert_eq!(ix.program_id, ctx.program_id);

    // Verify 4 accounts
    assert_eq!(
        ix.accounts.len(),
        4,
        "Blacklist remove instruction must have 4 accounts"
    );

    // Verify data: discriminator(8) + address(32) = 40 bytes
    assert_eq!(ix.data.len(), 40, "Remove data must be 40 bytes");

    // Verify address bytes in data
    assert_eq!(&ix.data[8..40], address.as_ref());
}

#[test]
fn test_mint_and_burn_have_different_discriminators() {
    let ctx = test_solana_context();
    let account = Pubkey::new_unique();

    let mint_ix = solana::build_mint_instruction(&ctx, &account, 1000);
    let burn_ix = solana::build_burn_instruction(&ctx, &account, 1000);

    // The first 8 bytes are the Anchor discriminator — they must differ
    assert_ne!(
        &mint_ix.data[..8],
        &burn_ix.data[..8],
        "Mint and burn instructions must have different discriminators"
    );
}

// ══════════════════════════════════════════════════════════════════════════
//  INPUT VALIDATION
// ══════════════════════════════════════════════════════════════════════════

#[test]
fn test_parse_pubkey_valid() {
    let result = solana::parse_pubkey("11111111111111111111111111111111");
    assert!(result.is_ok());
    assert_eq!(
        result.unwrap(),
        Pubkey::from_str("11111111111111111111111111111111").unwrap()
    );
}

#[test]
fn test_parse_pubkey_invalid() {
    let result = solana::parse_pubkey("not-a-valid-pubkey!!!");
    assert!(result.is_err());
}

#[test]
fn test_parse_pubkey_empty() {
    let result = solana::parse_pubkey("");
    assert!(result.is_err());
}

#[test]
fn test_load_keypair_nonexistent_file() {
    let result = solana::load_keypair_from_file("/tmp/nonexistent-sss-keypair-12345.json");
    assert!(result.is_err());
}

// ══════════════════════════════════════════════════════════════════════════
//  WEBHOOK SERVICE UNIT TESTS
// ══════════════════════════════════════════════════════════════════════════

#[tokio::test]
async fn test_webhook_service_register_and_list() {
    let service = WebhookService::new();

    let reg = service
        .register("https://example.com/a".to_string(), vec![], None)
        .await;
    assert!(reg.active);
    assert_eq!(reg.delivery_count, 0);
    assert_eq!(reg.failure_count, 0);

    let list = service.list_registrations().await;
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, reg.id);
}

#[tokio::test]
async fn test_webhook_service_register_multiple() {
    let service = WebhookService::new();

    service
        .register("https://example.com/a".to_string(), vec![], None)
        .await;
    service
        .register(
            "https://example.com/b".to_string(),
            vec!["TokensMinted".to_string()],
            None,
        )
        .await;
    service
        .register(
            "https://example.com/c".to_string(),
            vec![],
            Some("secret".to_string()),
        )
        .await;

    let list = service.list_registrations().await;
    assert_eq!(list.len(), 3);
}

#[tokio::test]
async fn test_webhook_service_unregister() {
    let service = WebhookService::new();

    let reg = service
        .register("https://example.com/hook".to_string(), vec![], None)
        .await;

    assert!(service.get_registration(&reg.id).await.is_some());

    let result = service.unregister(&reg.id).await;
    assert!(result.is_ok());

    assert!(service.get_registration(&reg.id).await.is_none());
    assert!(service.list_registrations().await.is_empty());
}

#[tokio::test]
async fn test_webhook_service_unregister_not_found() {
    let service = WebhookService::new();
    let result = service.unregister("does-not-exist").await;
    assert!(result.is_err());
}

#[tokio::test]
async fn test_webhook_service_delivery_log_empty() {
    let service = WebhookService::new();
    let log = service.get_delivery_log(100).await;
    assert!(log.is_empty());
}

#[tokio::test]
async fn test_webhook_service_persists_registrations_and_deliveries() {
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    let path = temp_file_path("webhook-persist");
    let service = Arc::new(WebhookService::with_persistence(&path).unwrap());
    let registration = service
        .register(mock_server.uri(), vec!["TokensMinted".to_string()], None)
        .await;

    service
        .dispatch_event_with_context(
            "TokensMinted",
            json!({ "amount": 42 }),
            DispatchMetadata {
                correlation_id: Some(
                    "tx:7xKXtg2xZJ8KkkcQbHKePkRykGGBqBPdZiZsa1onbXqN".to_string(),
                ),
                transaction_signature: Some(
                    "7xKXtg2xZJ8KkkcQbHKePkRykGGBqBPdZiZsa1onbXqN".to_string(),
                ),
                event_id: Some("event-42".to_string()),
            },
        )
        .await;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let log = service.get_delivery_log(100).await;
        if !log.is_empty() && log.iter().all(|entry| entry.status != DeliveryStatus::Pending) {
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("Webhook persistence test timed out waiting for delivery");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    drop(service);

    let reloaded = WebhookService::with_persistence(&path).unwrap();
    let registrations = reloaded.list_registrations().await;
    let deliveries = reloaded.get_delivery_log(100).await;

    assert_eq!(registrations.len(), 1);
    assert_eq!(registrations[0].id, registration.id);
    assert_eq!(deliveries.len(), 1);
    assert_eq!(deliveries[0].status, DeliveryStatus::Delivered);
    assert_eq!(
        deliveries[0].correlation_id.as_deref(),
        Some("tx:7xKXtg2xZJ8KkkcQbHKePkRykGGBqBPdZiZsa1onbXqN")
    );
    assert_eq!(
        deliveries[0].transaction_signature.as_deref(),
        Some("7xKXtg2xZJ8KkkcQbHKePkRykGGBqBPdZiZsa1onbXqN")
    );
    assert_eq!(deliveries[0].event_id.as_deref(), Some("event-42"));
}

#[tokio::test]
async fn test_mint_burn_service_persists_failed_operations() {
    let path = temp_file_path("mint-burn-persist");
    let ctx = Arc::new(SolanaContext::new(
        "http://127.0.0.1:1",
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap(),
        Pubkey::new_unique(),
        Keypair::new(),
    ));
    let service = MintBurnService::with_persistence(Arc::clone(&ctx), &path).unwrap();

    let result = service.mint("11111111111111111111111111111111", 1_000_000).await;
    assert!(result.is_err());

    let operations = service.list_operations(10).await;
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].status, OperationStatus::Failed);

    let reloaded = MintBurnService::with_persistence(ctx, &path).unwrap();
    let reloaded_operations = reloaded.list_operations(10).await;
    assert_eq!(reloaded_operations.len(), 1);
    assert_eq!(reloaded_operations[0].status, OperationStatus::Failed);
}

#[tokio::test]
async fn test_compliance_service_persists_checks() {
    let path = temp_file_path("compliance-persist");
    let ctx = Arc::new(SolanaContext::new(
        "http://127.0.0.1:1",
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap(),
        Pubkey::new_unique(),
        Keypair::new(),
    ));
    let service = ComplianceService::with_persistence(Arc::clone(&ctx), &path).unwrap();

    let blacklisted = service
        .check_blacklist("11111111111111111111111111111111")
        .await
        .unwrap();
    assert!(!blacklisted);

    let operations = service.list_operations(10).await;
    assert_eq!(operations.len(), 1);
    assert_eq!(operations[0].action, ComplianceAction::Check);

    let reloaded = ComplianceService::with_persistence(ctx, &path).unwrap();
    let reloaded_operations = reloaded.list_operations(10).await;
    assert_eq!(reloaded_operations.len(), 1);
    assert_eq!(reloaded_operations[0].action, ComplianceAction::Check);
}

// ══════════════════════════════════════════════════════════════════════════
//  SOLANA CONTEXT
// ══════════════════════════════════════════════════════════════════════════

#[test]
fn test_solana_context_derives_config_pda() {
    let keypair = Keypair::new();
    let program_id =
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap();
    let mint = Pubkey::new_unique();

    let ctx = SolanaContext::new("http://localhost:8899", program_id, mint, keypair);

    // Config PDA should be derived from ["stablecoin", mint]
    let (expected_pda, expected_bump) = solana::derive_config_pda(&mint, &program_id);
    assert_eq!(ctx.config_pda, expected_pda);
    assert_eq!(ctx.config_bump, expected_bump);
}

#[test]
fn test_solana_context_stores_program_id_and_mint() {
    let keypair = Keypair::new();
    let program_id =
        Pubkey::from_str("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu").unwrap();
    let mint = Pubkey::new_unique();

    let ctx = SolanaContext::new("http://localhost:8899", program_id, mint, keypair);

    assert_eq!(ctx.program_id, program_id);
    assert_eq!(ctx.mint, mint);
    assert_eq!(ctx.rpc_url, "http://localhost:8899");
}
