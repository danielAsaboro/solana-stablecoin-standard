//! Compliance API routes — blacklist management and audit log.
//!
//! All handlers extract [`AppState`] to access the [`ComplianceService`].
//! Returns 503 Service Unavailable if the Solana context is not configured.

use axum::{
    extract::{Json, Path, Query, State},
    http::StatusCode,
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
    pub address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    pub authority: String,
    pub timestamp: String,
}

impl From<ComplianceOperation> for AuditEntry {
    fn from(op: ComplianceOperation) -> Self {
        Self {
            id: op.id,
            action: match op.action {
                ComplianceAction::Blacklist => "blacklist",
                ComplianceAction::Unblacklist => "unblacklist",
                ComplianceAction::Check => "check",
            }
            .to_string(),
            address: op.address,
            reason: op.reason,
            status: match op.status {
                ComplianceStatus::Executing => "executing",
                ComplianceStatus::Completed => "completed",
                ComplianceStatus::Failed => "failed",
            }
            .to_string(),
            signature: op.signature,
            authority: op.authority,
            timestamp: op.completed_at.unwrap_or(op.created_at),
        }
    }
}

#[derive(Deserialize)]
pub struct AuditQuery {
    pub limit: Option<usize>,
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
    Query(query): Query<AuditQuery>,
) -> Result<Json<Vec<AuditEntry>>, AppError> {
    let service = get_service(&state)?;
    let limit = query.limit.unwrap_or(100).min(1000);
    let ops = service.list_audit_log(limit).await;
    Ok(Json(ops.into_iter().map(AuditEntry::from).collect()))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/blacklist", post(add_blacklist).get(get_blacklist_operations))
        .route("/blacklist/{addr}", delete(remove_blacklist).get(check_blacklist))
        .route("/audit", get(get_audit))
}
