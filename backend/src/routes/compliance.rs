//! Compliance API routes — blacklist management and audit log.
//!
//! All handlers extract [`AppState`] to access the [`ComplianceService`].
//! Returns 503 Service Unavailable if the Solana context is not configured.

use axum::{
    extract::{Json, Path, Query, State},
    http::{
        header::{self, HeaderMap, HeaderValue},
        StatusCode,
    },
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::services::compliance::{ComplianceAction, ComplianceOperation, ComplianceService, ComplianceStatus};
use crate::AppState;

// ── Request / Response Types ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct BlacklistRequest {
    pub address: String,
    pub reason: String,
}

#[derive(Serialize)]
pub struct BlacklistResponse {
    pub id: String,
    pub address: String,
    pub status: String,
    pub action: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    pub authority: String,
}

impl From<ComplianceOperation> for BlacklistResponse {
    fn from(op: ComplianceOperation) -> Self {
        Self {
            id: op.id,
            address: op.address,
            status: match op.status {
                ComplianceStatus::Executing => "executing",
                ComplianceStatus::Completed => "completed",
                ComplianceStatus::Failed => "failed",
            }
            .to_string(),
            action: match op.action {
                ComplianceAction::Blacklist => "blacklist",
                ComplianceAction::Unblacklist => "unblacklist",
                ComplianceAction::Check => "check",
            }
            .to_string(),
            reason: op.reason,
            signature: op.signature,
            error: op.error,
            created_at: op.created_at,
            completed_at: op.completed_at,
            authority: op.authority,
        }
    }
}

#[derive(Serialize)]
pub struct BlacklistCheckResponse {
    pub address: String,
    pub blacklisted: bool,
}

#[derive(Serialize)]
pub struct AuditEntry {
    pub id: String,
    pub action: String,
    pub event_type: String,
    pub severity: String,
    pub target_type: String,
    pub target_address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    pub authority: String,
    pub timestamp: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl From<ComplianceOperation> for AuditEntry {
    fn from(op: ComplianceOperation) -> Self {
        let action = match op.action {
            ComplianceAction::Blacklist => "blacklist",
            ComplianceAction::Unblacklist => "unblacklist",
            ComplianceAction::Check => "check",
        }
        .to_string();
        let status = match op.status {
            ComplianceStatus::Executing => "executing",
            ComplianceStatus::Completed => "completed",
            ComplianceStatus::Failed => "failed",
        }
        .to_string();
        let severity = match op.status {
            ComplianceStatus::Failed => "error",
            ComplianceStatus::Executing => "warning",
            ComplianceStatus::Completed => "info",
        }
        .to_string();
        Self {
            id: op.id,
            event_type: format!("compliance.{action}"),
            action,
            severity,
            target_type: "wallet".to_string(),
            target_address: op.address,
            reason: op.reason,
            status,
            signature: op.signature,
            authority: op.authority,
            timestamp: op.completed_at.unwrap_or(op.created_at),
            error: op.error,
        }
    }
}

#[derive(Deserialize)]
pub struct AuditQuery {
    pub limit: Option<usize>,
    pub format: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuditFormat {
    Json,
    Jsonl,
}

impl AuditFormat {
    fn from_request(query: &AuditQuery, headers: &HeaderMap) -> Self {
        if matches!(
            query.format.as_deref(),
            Some("jsonl" | "ndjson" | "application/x-ndjson")
        ) {
            return Self::Jsonl;
        }

        let accepts_ndjson = headers
            .get(header::ACCEPT)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.contains("application/x-ndjson"));

        if accepts_ndjson {
            Self::Jsonl
        } else {
            Self::Json
        }
    }
}

fn render_jsonl(entries: &[AuditEntry]) -> Result<String, AppError> {
    let lines = entries
        .iter()
        .map(serde_json::to_string)
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::Internal(format!("Failed to serialize audit log: {error}")))?;
    Ok(lines.join("\n"))
}

// ── Helper ─────────────────────────────────────────────────────────────────

fn get_service(state: &AppState) -> Result<&ComplianceService, AppError> {
    state.compliance.as_deref().ok_or_else(|| {
        AppError::NotConfigured(
            "Solana not configured. Set SSS_MINT_ADDRESS and SSS_KEYPAIR_PATH.".to_string(),
        )
    })
}

// ── Handlers ───────────────────────────────────────────────────────────────

async fn add_blacklist(
    State(state): State<AppState>,
    Json(req): Json<BlacklistRequest>,
) -> Result<(StatusCode, Json<BlacklistResponse>), AppError> {
    let service = get_service(&state)?;
    let op = service.add_to_blacklist(&req.address, &req.reason).await?;
    Ok((StatusCode::CREATED, Json(BlacklistResponse::from(op))))
}

async fn remove_blacklist(
    State(state): State<AppState>,
    Path(addr): Path<String>,
) -> Result<Json<BlacklistResponse>, AppError> {
    let service = get_service(&state)?;
    let op = service.remove_from_blacklist(&addr).await?;
    Ok(Json(BlacklistResponse::from(op)))
}

async fn check_blacklist(
    State(state): State<AppState>,
    Path(addr): Path<String>,
) -> Result<Json<BlacklistCheckResponse>, AppError> {
    let service = get_service(&state)?;
    let blacklisted = service.check_blacklist(&addr).await?;
    Ok(Json(BlacklistCheckResponse {
        address: addr,
        blacklisted,
    }))
}

async fn get_blacklist_operations(
    State(state): State<AppState>,
) -> Result<Json<Vec<BlacklistResponse>>, AppError> {
    let service = get_service(&state)?;
    let ops = service.list_operations(100).await;
    Ok(Json(ops.into_iter().map(BlacklistResponse::from).collect()))
}

async fn get_audit(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuditQuery>,
) -> Result<Response, AppError> {
    let service = get_service(&state)?;
    let limit = query.limit.unwrap_or(100).min(1000);
    let ops = service.list_audit_log(limit).await;
    let entries = ops.into_iter().map(AuditEntry::from).collect::<Vec<_>>();

    match AuditFormat::from_request(&query, &headers) {
        AuditFormat::Json => Ok(Json(entries).into_response()),
        AuditFormat::Jsonl => Ok((
            [(header::CONTENT_TYPE, HeaderValue::from_static("application/x-ndjson"))],
            render_jsonl(&entries)?,
        )
            .into_response()),
    }
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/blacklist", post(add_blacklist).get(get_blacklist_operations))
        .route("/blacklist/{addr}", delete(remove_blacklist).get(check_blacklist))
        .route("/audit", get(get_audit))
}
