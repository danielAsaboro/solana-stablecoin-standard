//! Backend integration tests for the Solana Stablecoin Standard (SSS).
//!
//! Tests the REST API endpoints, webhook service, PDA derivation, instruction
//! builders, and input validation. Tests run without a real Solana connection —
//! services that require Solana are tested for correct 503 Service Unavailable
//! responses, while the webhook service and pure functions are tested end-to-end.

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

use sss_backend::services::webhook::{DeliveryStatus, WebhookService};
use sss_backend::solana::{self, SolanaContext};
use sss_backend::AppState;

// ── Test Helpers ──────────────────────────────────────────────────────────

/// Create an AppState with no Solana configuration (webhook only).
fn unconfigured_state() -> AppState {
    AppState {
        mint_burn: None,
        compliance: None,
        indexer: None,
        webhook: Arc::new(WebhookService::new()),
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
    };
    (sss_backend::build_router(state), webhook)
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
    let mock_server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(wiremock::ResponseTemplate::new(200))
        .mount(&mock_server)
        .await;

    let webhook = Arc::new(WebhookService::new());
    webhook
        .register(mock_server.uri(), vec![], None)
        .await;

    webhook
        .dispatch_event("TokensMinted", json!({"amount": 1000}))
        .await;

    // Wait for delivery to complete
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let log = webhook.get_delivery_log(100).await;
        if !log.is_empty() && log.iter().all(|r| r.status != DeliveryStatus::Pending) {
            assert_eq!(log[0].status, DeliveryStatus::Delivered);
            assert_eq!(log[0].event_type, "TokensMinted");
            assert_eq!(log[0].attempts, 1);
            break;
        }
        if tokio::time::Instant::now() >= deadline {
            panic!("Delivery did not complete within 5 seconds");
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
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

    let ix = solana::build_add_to_blacklist_instruction(&ctx, &address, reason);

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

    // Verify data: discriminator(8) + address(32) + reason_len(4) + reason(var)
    let expected_len = 8 + 32 + 4 + reason.len();
    assert_eq!(ix.data.len(), expected_len);

    // Verify address bytes in data
    assert_eq!(&ix.data[8..40], address.as_ref());

    // Verify reason length (little-endian u32)
    let reason_len = u32::from_le_bytes(ix.data[40..44].try_into().unwrap());
    assert_eq!(reason_len as usize, reason.len());

    // Verify reason bytes
    assert_eq!(&ix.data[44..], reason.as_bytes());
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
