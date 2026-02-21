# Backend API Reference

## Overview

The SSS backend is a Rust/Axum REST API that wraps the on-chain programs for programmatic access. It provides operation lifecycle management, compliance endpoints, and webhook notifications.

## Running

### Docker Compose

```bash
cd backend
docker compose up
```

This starts:
- **backend** on port `3001`
- **postgres** on port `5432`

### Local Development

```bash
cd backend
cargo run
```

The server starts on `http://localhost:3001`.

## Authentication

All `/api/v1/*` endpoints require an API key in the `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:3001/api/v1/mint
```

Set the API key via the `SSS_API_KEY` environment variable. If not set, defaults to `dev-api-key` in development.

## Endpoints

### Health Check

```
GET /health
```

**Response** `200 OK`:
```json
{
  "status": "healthy",
  "version": "0.1.0"
}
```

---

### Mint Tokens

```
POST /api/v1/mint
```

**Request Body**:
```json
{
  "recipient": "<base58-public-key>",
  "amount": 1000000
}
```

**Response** `202 Accepted`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "pending",
  "message": "Mint of 1000000 queued"
}
```

**Operation lifecycle**: `pending` → `verified` → `executing` → `completed` / `failed`

---

### Burn Tokens

```
POST /api/v1/burn
```

**Request Body**:
```json
{
  "from_account": "<base58-token-account>",
  "amount": 500000
}
```

**Response** `202 Accepted`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "status": "pending",
  "message": "Burn of 500000 queued"
}
```

---

### Add to Blacklist

```
POST /api/v1/blacklist
```

**Request Body**:
```json
{
  "address": "<base58-public-key>",
  "reason": "Sanctions compliance"
}
```

**Response** `201 Created`:
```json
{
  "address": "<base58-public-key>",
  "status": "blacklisted",
  "message": "Added"
}
```

---

### Remove from Blacklist

```
DELETE /api/v1/blacklist/{address}
```

**Response** `200 OK`:
```json
{
  "address": "<base58-public-key>",
  "status": "removed",
  "message": "Removed"
}
```

---

### Get Blacklist

```
GET /api/v1/blacklist
```

**Response** `200 OK`:
```json
[
  {
    "address": "<base58-public-key>",
    "reason": "Sanctions compliance",
    "blacklisted_at": "2025-01-15T10:30:00Z"
  }
]
```

---

### Get Audit Log

```
GET /api/v1/audit
```

**Query Parameters**:
- `action` (optional) — filter by action type (`mint`, `burn`, `blacklist`, `seize`, etc.)
- `from` (optional) — start timestamp (ISO 8601)
- `to` (optional) — end timestamp (ISO 8601)
- `limit` (optional) — max results (default: 100)

**Response** `200 OK`:
```json
[
  {
    "action": "mint",
    "timestamp": "2025-01-15T10:30:00Z",
    "details": {
      "recipient": "<base58-public-key>",
      "amount": 1000000,
      "minter": "<base58-public-key>"
    }
  }
]
```

---

### Register Webhook

```
POST /api/v1/webhooks
```

**Request Body**:
```json
{
  "url": "https://your-service.com/webhook",
  "events": ["mint", "burn", "blacklist", "seize"]
}
```

**Response** `201 Created`:
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440002",
  "url": "https://your-service.com/webhook",
  "events": ["mint", "burn", "blacklist", "seize"],
  "status": "active"
}
```

**Webhook Payload** (sent to registered URL):
```json
{
  "event": "mint",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "recipient": "<base58-public-key>",
    "amount": 1000000,
    "status": "completed",
    "tx_signature": "<base58-signature>"
  }
}
```

Webhooks use exponential backoff retry (3 attempts, 1s → 4s → 16s).

## Error Responses

All errors return a JSON body:

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

| Status Code | Meaning |
|-------------|---------|
| `400` | Bad Request — invalid parameters |
| `401` | Unauthorized — missing or invalid API key |
| `404` | Not Found — resource does not exist |
| `409` | Conflict — duplicate operation (e.g., already blacklisted) |
| `500` | Internal Server Error |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SSS_API_KEY` | API key for authentication | `dev-api-key` |
| `SSS_RPC_URL` | Solana RPC endpoint | `http://localhost:8899` |
| `SSS_PROGRAM_ID` | SSS program public key | — |
| `SSS_MINT` | Stablecoin mint public key | — |
| `SSS_KEYPAIR` | Path to authority keypair | — |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://sss:sss@localhost:5432/sss` |
| `PORT` | Server port | `3001` |
