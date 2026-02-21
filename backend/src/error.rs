//! Typed error handling for the SSS backend.
//!
//! [`AppError`] unifies all error sources (validation, Solana RPC, configuration)
//! and implements [`axum::response::IntoResponse`] so handlers can return
//! `Result<T, AppError>` directly.

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

/// Unified error type for all backend operations.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// Input validation failure (bad address, zero amount, etc.)
    #[error("Invalid input: {0}")]
    InvalidInput(String),

    /// Solana RPC communication error (network, timeout, etc.)
    #[error("Solana RPC error: {0}")]
    SolanaRpc(String),

    /// On-chain transaction failed (program error, insufficient funds, etc.)
    #[error("Transaction failed: {0}")]
    TransactionFailed(String),

    /// Required service configuration is missing
    #[error("Service not configured: {0}")]
    NotConfigured(String),

    /// Requested resource not found
    #[error("Not found: {0}")]
    NotFound(String),

    /// Unexpected internal error
    #[error("Internal error: {0}")]
    Internal(String),
}

/// JSON error response returned to API clients.
#[derive(Serialize)]
struct ErrorResponse {
    error: String,
    code: String,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code) = match &self {
            AppError::InvalidInput(_) => (StatusCode::BAD_REQUEST, "INVALID_INPUT"),
            AppError::SolanaRpc(_) => (StatusCode::BAD_GATEWAY, "SOLANA_RPC_ERROR"),
            AppError::TransactionFailed(_) => (StatusCode::BAD_GATEWAY, "TRANSACTION_FAILED"),
            AppError::NotConfigured(_) => (StatusCode::SERVICE_UNAVAILABLE, "NOT_CONFIGURED"),
            AppError::NotFound(_) => (StatusCode::NOT_FOUND, "NOT_FOUND"),
            AppError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR"),
        };

        let body = ErrorResponse {
            error: self.to_string(),
            code: code.to_string(),
        };

        (status, Json(body)).into_response()
    }
}
