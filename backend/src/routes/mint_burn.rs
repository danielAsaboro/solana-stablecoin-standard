//! Mint and burn API routes — execute on-chain token operations.
//!
//! All handlers extract [`AppState`] to access the [`MintBurnService`].
//! Returns 503 Service Unavailable if the Solana context is not configured.

use axum::{
    extract::{Json, Path, State},
    http::StatusCode,
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::services::mint_burn::{MintBurnOperation, MintBurnService, OperationStatus};
use crate::AppState;

// ── Request / Response Types ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct MintRequest {
    pub recipient: String,
    pub amount: u64,
}

#[derive(Deserialize)]
pub struct BurnRequest {
    pub from_account: String,
    pub amount: u64,
}

#[derive(Serialize)]
pub struct OpResponse {
    pub id: String,
    pub status: String,
    pub operation_type: String,
    pub amount: u64,
    pub target: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

impl From<MintBurnOperation> for OpResponse {
    fn from(op: MintBurnOperation) -> Self {
        Self {
            id: op.id,
            status: match op.status {
                OperationStatus::Pending => "pending",
                OperationStatus::Executing => "executing",
                OperationStatus::Completed => "completed",
                OperationStatus::Failed => "failed",
            }
            .to_string(),
            operation_type: op.operation_type,
            amount: op.amount,
            target: op.target,
            signature: op.signature,
            error: op.error,
            created_at: op.created_at,
            completed_at: op.completed_at,
        }
    }
}

#[derive(Serialize)]
pub struct ServiceInfo {
    pub service_pubkey: String,
    pub mint_address: String,
    pub config_address: String,
    pub program_id: String,
}

// ── Helper ─────────────────────────────────────────────────────────────────

fn get_service(state: &AppState) -> Result<&MintBurnService, AppError> {
    state.mint_burn.as_deref().ok_or_else(|| {
        AppError::NotConfigured(
            "Solana not configured. Set SSS_MINT_ADDRESS and SSS_KEYPAIR_PATH.".to_string(),
        )
    })
}

// ── Handlers ───────────────────────────────────────────────────────────────

async fn mint_handler(
    State(state): State<AppState>,
    Json(req): Json<MintRequest>,
) -> Result<(StatusCode, Json<OpResponse>), AppError> {
    let service = get_service(&state)?;
    let op = service.mint(&req.recipient, req.amount).await?;
    Ok((StatusCode::OK, Json(OpResponse::from(op))))
}

async fn burn_handler(
    State(state): State<AppState>,
    Json(req): Json<BurnRequest>,
) -> Result<(StatusCode, Json<OpResponse>), AppError> {
    let service = get_service(&state)?;
    let op = service.burn(&req.from_account, req.amount).await?;
    Ok((StatusCode::OK, Json(OpResponse::from(op))))
}

async fn get_operation(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<OpResponse>, AppError> {
    let service = get_service(&state)?;
    let op = service
        .get_operation(&id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Operation '{id}' not found")))?;
    Ok(Json(OpResponse::from(op)))
}

async fn list_operations(State(state): State<AppState>) -> Result<Json<Vec<OpResponse>>, AppError> {
    let service = get_service(&state)?;
    let ops = service.list_operations(100).await;
    Ok(Json(ops.into_iter().map(OpResponse::from).collect()))
}

async fn service_info(State(state): State<AppState>) -> Result<Json<ServiceInfo>, AppError> {
    let service = get_service(&state)?;
    Ok(Json(ServiceInfo {
        service_pubkey: service.service_pubkey(),
        mint_address: service.mint_address(),
        config_address: service.config_address(),
        program_id: service.program_id(),
    }))
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/mint", post(mint_handler))
        .route("/burn", post(burn_handler))
        .route("/operations", get(list_operations))
        .route("/operations/{id}", get(get_operation))
        .route("/info", get(service_info))
}
