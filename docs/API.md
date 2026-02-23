# Backend API Reference

## Overview

The SSS backend is a Rust/Axum REST API that wraps the on-chain programs for programmatic access.
It provides synchronous on-chain execution, operation tracking, compliance management, on-chain event indexing, and webhook notifications.

**Base URL:** `http://localhost:3001`
**API prefix:** `/api/v1/`
**Content-Type:** `application/json`

---

## Running

### Docker Compose

```bash
cd backend
docker compose up
```

This starts the **backend** on port `3001`. All data is stored in-memory; no external database is required.

### Local Development

```bash
cd backend
cargo run
```

The server starts on `http://localhost:3001`.

---

## Authentication

When `SSS_API_KEY` is set, all `/api/v1/*` endpoints require the key in the `x-api-key` header:

```bash
curl -H "x-api-key: your-api-key" http://localhost:3001/api/v1/info
```

The `/health` endpoint is always unauthenticated. If `SSS_API_KEY` is not set (or empty), no authentication is enforced — useful for local development.

**Unauthorized response** (`401`):
```json
{ "error": "Unauthorized", "message": "Invalid or missing API key" }
```

---

## Service Availability

Endpoints that require on-chain access return `503 Service Unavailable` when `SSS_MINT_ADDRESS` is not configured:

```json
{
  "error": "NotConfigured",
  "message": "Solana not configured. Set SSS_MINT_ADDRESS and SSS_KEYPAIR_PATH."
}
```

Webhook endpoints are **always available** regardless of Solana configuration.

---

## Endpoints

### Health Check

```
GET /health
```

No authentication required. Always returns `200 OK` if the process is running.

**Response** `200 OK`:
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "solana_configured": true,
  "services": {
    "mint_burn": true,
    "compliance": true,
    "indexer": true,
    "webhooks": true
  }
}
```

| Field | Description |
|-------|-------------|
| `status` | Always `"healthy"` if the process is running |
| `version` | Backend package version from `Cargo.toml` |
| `solana_configured` | `true` if `SSS_MINT_ADDRESS` is set and valid |
| `services.mint_burn` | Mint/burn operations available |
| `services.compliance` | Blacklist/compliance operations available |
| `services.indexer` | Background event indexer running |
| `services.webhooks` | Webhook delivery available (always `true`) |

---

### Service Info

```
GET /api/v1/info
```

Returns the backend's Solana configuration. Useful for verifying deployment.

**Response** `200 OK`:
```json
{
  "service_pubkey": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
  "mint_address": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "config_address": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
  "program_id": "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
}
```

---

### Mint Tokens

```
POST /api/v1/mint
```

Executes an on-chain mint operation **synchronously**. Builds and signs a `mint_tokens` instruction, sends it to Solana, and waits for confirmation before returning.

**Request Body**:
```json
{
  "recipient": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "amount": 1000000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `recipient` | `string` | Base58 wallet address to receive tokens |
| `amount` | `u64` | Amount in base units (e.g., `1000000` = 1.00 MUSD with 6 decimals) |

**Response** `200 OK`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "operation_type": "mint",
  "amount": 1000000,
  "target": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "signature": "3Hf7xZ2qK9mNpRtVwXyZaBcDeFgHiJkLmNoPqRsTuVwX",
  "created_at": "2025-01-15T10:30:00Z",
  "completed_at": "2025-01-15T10:30:01Z"
}
```

| Field | Description |
|-------|-------------|
| `id` | UUID v4 operation identifier |
| `status` | `"executing"` → `"completed"` or `"failed"` |
| `operation_type` | `"mint"` |
| `amount` | Amount minted in base units |
| `target` | Recipient wallet address |
| `signature` | Solana transaction signature (present on completion) |
| `error` | Error message (present on failure) |
| `created_at` | ISO 8601 creation timestamp |
| `completed_at` | ISO 8601 completion timestamp |

**Operation lifecycle**: `pending` → `executing` → `completed` | `failed`

**Errors**:
- `400 Bad Request` — invalid recipient address format
- `502 Bad Gateway` — Solana RPC error (program error, quota exceeded, etc.)
- `503 Service Unavailable` — Solana not configured

---

### Burn Tokens

```
POST /api/v1/burn
```

Executes an on-chain burn operation **synchronously**.

**Request Body**:
```json
{
  "from_account": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  "amount": 500000
}
```

| Field | Type | Description |
|-------|------|-------------|
| `from_account` | `string` | Base58 token account address to burn from |
| `amount` | `u64` | Amount to burn in base units |

**Response** `200 OK`: Same shape as mint response with `operation_type: "burn"`.

---

### List Operations

```
GET /api/v1/operations
```

Returns recent mint/burn operations, newest first (max 100).

**Response** `200 OK`: Array of operation objects (same shape as mint/burn response).

---

### Get Operation

```
GET /api/v1/operations/{id}
```

Returns a specific operation by its UUID.

**Response** `200 OK`: Single operation object.

**Errors**: `404 Not Found` — operation ID not found.

---

### Add to Blacklist

```
POST /api/v1/blacklist
```

Adds an address to the on-chain blacklist (SSS-2 only). Creates a `BlacklistEntry` PDA. After this call, any `transfer_checked` involving this address will be rejected by the transfer hook.

**Request Body**:
```json
{
  "address": "7Xzw3pQFkHhgx3nL9mVqRsJkYtBnXdWpHcGfZeKuAmPs",
  "reason": "OFAC sanctions compliance"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `address` | `string` | Base58 wallet address to blacklist |
| `reason` | `string` | Human-readable justification (max 64 chars) |

**Response** `200 OK`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "address": "7Xzw3pQFkHhgx3nL9mVqRsJkYtBnXdWpHcGfZeKuAmPs",
  "status": "completed",
  "action": "blacklist",
  "reason": "OFAC sanctions compliance",
  "signature": "7Mn2kL3...",
  "authority": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
  "created_at": "2025-01-15T10:32:00Z",
  "completed_at": "2025-01-15T10:32:01Z"
}
```

---

### Remove from Blacklist

```
DELETE /api/v1/blacklist/{address}
```

Removes an address from the on-chain blacklist. Closes the `BlacklistEntry` PDA and returns rent to the authority.

**Response** `200 OK`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "address": "7Xzw3pQFkHhgx3nL9mVqRsJkYtBnXdWpHcGfZeKuAmPs",
  "status": "completed",
  "action": "unblacklist",
  "signature": "9Qr4pN7...",
  "authority": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
  "created_at": "2025-01-15T10:33:00Z",
  "completed_at": "2025-01-15T10:33:01Z"
}
```

---

### Check Blacklist Status

```
GET /api/v1/blacklist/{address}
```

Queries the on-chain `BlacklistEntry` PDA to check whether an address is currently blacklisted.

**Response** `200 OK`:
```json
{
  "address": "7Xzw3pQFkHhgx3nL9mVqRsJkYtBnXdWpHcGfZeKuAmPs",
  "blacklisted": true
}
```

---

### List Blacklist Operations

```
GET /api/v1/blacklist
```

Returns all compliance operations (blacklist/unblacklist actions), newest first.

**Response** `200 OK`: Array of compliance operation objects.

---

### Get Audit Log

```
GET /api/v1/audit
```

Returns the compliance audit trail (all blacklist and unblacklist operations), newest first. Excludes read-only check queries.

**Response** `200 OK`:
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440002",
    "action": "blacklist",
    "address": "7Xzw3pQFkHhgx3nL9mVqRsJkYtBnXdWpHcGfZeKuAmPs",
    "reason": "OFAC sanctions compliance",
    "status": "completed",
    "signature": "7Mn2kL3...",
    "authority": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
    "timestamp": "2025-01-15T10:32:00Z"
  }
]
```

---

### List Events

```
GET /api/v1/events
```

Returns indexed on-chain SSS program events. The indexer background task polls the config PDA for new transactions and parses Anchor event logs from `Program data:` entries.

**Query Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `event_type` | `string` | Filter by event name (e.g. `"TokensMinted"`) |
| `limit` | `number` | Max events to return (default: `100`, max: `1000`) |
| `before_signature` | `string` | Pagination cursor — return events before this tx signature |

**Response** `200 OK`:
```json
[
  {
    "signature": "3Hf7xZ2qK9mNpRtVwXyZaBcDeFgHiJkLmNoPqRsTuVwX",
    "slot": 123456789,
    "block_time": 1705312200,
    "event_name": "TokensMinted",
    "data": {
      "config": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
      "recipient": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
      "amount": 1000000,
      "minter": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
      "total_minted": 5000000
    }
  }
]
```

**Available event types**:

| Event Name | Trigger |
|------------|---------|
| `StablecoinInitialized` | `initialize` instruction |
| `TokensMinted` | `mint_tokens` instruction |
| `TokensBurned` | `burn_tokens` instruction |
| `AccountFrozen` | `freeze_account` instruction |
| `AccountThawed` | `thaw_account` instruction |
| `StablecoinPaused` | `pause` instruction |
| `StablecoinUnpaused` | `unpause` instruction |
| `RoleUpdated` | `update_roles` instruction |
| `MinterUpdated` | `update_minter` instruction |
| `AuthorityTransferred` | `transfer_authority` instruction |
| `AccountBlacklisted` | `add_to_blacklist` instruction (SSS-2) |
| `AccountUnblacklisted` | `remove_from_blacklist` instruction (SSS-2) |
| `TokensSeized` | `seize` instruction (SSS-2) |

---

### Get Event Count

```
GET /api/v1/events/count
```

**Response** `200 OK`:
```json
{
  "count": 42
}
```

---

### Get Indexer Status

```
GET /api/v1/events/status
```

**Response** `200 OK`:
```json
{
  "total_events": 42,
  "latest_slot": 123456789,
  "config_address": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
  "program_id": "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
}
```

---

### Register Webhook

```
POST /api/v1/webhooks
```

Registers a URL to receive HTTP POST notifications when on-chain events occur. Always available regardless of Solana configuration.

**Request Body**:
```json
{
  "url": "https://your-service.com/webhook",
  "events": ["TokensMinted", "AccountBlacklisted"],
  "secret": "optional-hmac-secret"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string` | HTTP(S) URL to receive POST deliveries. Must have `http://` or `https://` scheme |
| `events` | `string[]` | Event types to subscribe to. Empty array means all events |
| `secret` | `string?` | Optional HMAC-SHA256 secret for payload signing |

**Response** `201 Created`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "url": "https://your-service.com/webhook",
  "events": ["TokensMinted", "AccountBlacklisted"],
  "active": true,
  "created_at": "2025-01-15T10:00:00Z",
  "delivery_count": 0,
  "failure_count": 0
}
```

**Webhook Payload** (delivered as HTTP POST):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440020",
  "event_type": "TokensMinted",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    "config": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
    "recipient": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "amount": 1000000,
    "minter": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
    "total_minted": 5000000
  }
}
```

When a `secret` is configured, deliveries include an HMAC-SHA256 signature header:
```
X-SSS-Signature: sha256=a1b2c3d4e5f6...
```

Verify the signature: `HMAC-SHA256(secret, raw_request_body_bytes)`.

**Retry policy**: Up to 3 delivery attempts with exponential backoff (1s → 2s → 4s). HTTP 4xx responses are treated as permanent failures and not retried.

---

### List Webhooks

```
GET /api/v1/webhooks
```

**Response** `200 OK`: Array of webhook registration objects.

---

### Get Webhook

```
GET /api/v1/webhooks/{id}
```

**Response** `200 OK`: Single webhook registration object.

**Errors**: `404 Not Found`.

---

### Delete Webhook

```
DELETE /api/v1/webhooks/{id}
```

Unregisters a webhook. Future events will not be delivered to this URL.

**Response** `200 OK`:
```json
{ "message": "Webhook unregistered" }
```

---

### Get Delivery Log

```
GET /api/v1/webhooks/deliveries
```

Returns recent webhook delivery attempts (newest first, max 10,000 entries).

**Response** `200 OK`:
```json
[
  {
    "id": "550e8400-e29b-41d4-a716-446655440030",
    "webhook_id": "550e8400-e29b-41d4-a716-446655440010",
    "event_type": "TokensMinted",
    "status": "delivered",
    "http_status": 200,
    "attempt": 1,
    "created_at": "2025-01-15T10:30:00Z",
    "response_time_ms": 145
  }
]
```

| `status` | Description |
|----------|-------------|
| `pending` | Delivery in progress |
| `delivered` | Received 2xx HTTP response |
| `failed` | All retry attempts exhausted |

---

## Error Responses

All errors return a JSON body:

```json
{
  "error": "NotFound",
  "message": "Operation 550e8400... not found"
}
```

| Status Code | Error Type | When |
|-------------|------------|------|
| `400` | `InvalidInput` | Invalid address, empty reason, out-of-range amount |
| `401` | `Unauthorized` | Missing or invalid `x-api-key` header |
| `404` | `NotFound` | Operation, webhook, or resource doesn't exist |
| `500` | `Internal` | Unexpected server error |
| `502` | `SolanaRpc` | Solana RPC error (program rejected tx, network issue) |
| `503` | `NotConfigured` | `SSS_MINT_ADDRESS` not set |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3001` | HTTP server listen port |
| `SSS_API_KEY` | No | _(none)_ | API key for auth. Auth is disabled if unset |
| `RPC_URL` | No | `http://127.0.0.1:8899` | Solana JSON-RPC endpoint |
| `SSS_PROGRAM_ID` | No | localnet ID | SSS program public key |
| `SSS_MINT_ADDRESS` | **Yes** | _(none)_ | Token-2022 mint address. Required for Solana ops |
| `SSS_KEYPAIR_PATH` | No | `~/.config/solana/id.json` | Service keypair. Must hold required on-chain roles |
| `SSS_INDEXER_INTERVAL_SECS` | No | `10` | Event indexer polling interval in seconds |
| `RUST_LOG` | No | `sss_backend=debug` | Rust tracing log filter |

Copy `backend/.env.example` for a complete annotated reference.

---

## Quick Start

```bash
# 1. Start in degraded mode (no Solana config)
cd backend && cargo run

# 2. Check health
curl http://localhost:3001/health

# 3. Start with Solana config
SSS_MINT_ADDRESS=<your-mint> \
SSS_API_KEY=secret \
cargo run

# 4. Mint tokens
curl -X POST http://localhost:3001/api/v1/mint \
  -H "Content-Type: application/json" \
  -H "x-api-key: secret" \
  -d '{"recipient": "<wallet>", "amount": 1000000}'

# 5. Query events
curl http://localhost:3001/api/v1/events?event_type=TokensMinted \
  -H "x-api-key: secret"

# 6. Register webhook
curl -X POST http://localhost:3001/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "x-api-key: secret" \
  -d '{"url": "https://your-service.com/hook", "events": ["TokensMinted"]}'
```
