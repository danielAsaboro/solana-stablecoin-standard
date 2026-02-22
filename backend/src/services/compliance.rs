//! Compliance service — blacklist management via on-chain PDAs.
//!
//! Executes `add_to_blacklist` and `remove_from_blacklist` instructions against
//! the SSS program, and can query on-chain state to check whether an address is
//! currently blacklisted. All operations are tracked in an in-memory audit log.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use solana_sdk::signer::Signer;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::AppError;
use crate::solana::{
    build_add_to_blacklist_instruction, build_remove_from_blacklist_instruction,
    derive_blacklist_pda, parse_pubkey, SolanaContext,
};

/// Maximum length for a blacklist reason string (matches on-chain `MAX_REASON_LEN`).
const MAX_REASON_LEN: usize = 64;

/// Type of compliance operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ComplianceAction {
    /// Address added to the on-chain blacklist.
    Blacklist,
    /// Address removed from the on-chain blacklist.
    Unblacklist,
    /// Blacklist status queried (no on-chain transaction).
    Check,
}

/// Lifecycle status of a compliance operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ComplianceStatus {
    /// Transaction sent, awaiting confirmation.
    Executing,
    /// Transaction confirmed on-chain.
    Completed,
    /// Transaction or query failed.
    Failed,
}

/// A tracked compliance operation with full lifecycle metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComplianceOperation {
    /// Unique operation identifier (UUID v4).
    pub id: String,
    /// The compliance action performed.
    pub action: ComplianceAction,
    /// The target address.
    pub address: String,
    /// Reason string (only for blacklist operations).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Current operation status.
    pub status: ComplianceStatus,
    /// Solana transaction signature (set on completion for on-chain operations).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Error message (set on failure).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// ISO 8601 timestamp when the operation was created.
    pub created_at: String,
    /// ISO 8601 timestamp when the operation completed or failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    /// The authority that performed the action.
    pub authority: String,
}

/// Service for managing on-chain blacklist operations via the SSS program.
///
/// Builds Anchor-compatible instructions for `add_to_blacklist` and
/// `remove_from_blacklist`, signs with the configured service keypair,
/// sends transactions, and maintains an in-memory audit log.
pub struct ComplianceService {
    ctx: Arc<SolanaContext>,
    operations: RwLock<HashMap<String, ComplianceOperation>>,
}

impl ComplianceService {
    /// Create a new compliance service with the given Solana context.
    pub fn new(ctx: Arc<SolanaContext>) -> Self {
        Self {
            ctx,
            operations: RwLock::new(HashMap::new()),
        }
    }

    /// Add an address to the on-chain blacklist.
    ///
    /// Builds an `add_to_blacklist` instruction, signs and sends the transaction.
    /// The service keypair must hold an active Blacklister role and the stablecoin
    /// must have `enable_transfer_hook = true` (SSS-2).
    pub async fn add_to_blacklist(
        &self,
        address: &str,
        reason: &str,
    ) -> Result<ComplianceOperation, AppError> {
        let address_pubkey = parse_pubkey(address)?;

        if reason.len() > MAX_REASON_LEN {
            return Err(AppError::InvalidInput(format!(
                "Reason exceeds maximum length of {MAX_REASON_LEN} bytes"
            )));
        }

        let id = Uuid::new_v4().to_string();
        let authority = self.ctx.keypair.pubkey().to_string();
        let mut op = ComplianceOperation {
            id: id.clone(),
            action: ComplianceAction::Blacklist,
            address: address.to_string(),
            reason: Some(reason.to_string()),
            status: ComplianceStatus::Executing,
            signature: None,
            error: None,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
            authority: authority.clone(),
        };

        self.operations.write().await.insert(id.clone(), op.clone());

        tracing::info!(
            op_id = %id,
            address = %address,
            reason = %reason,
            authority = %authority,
            "Executing add_to_blacklist"
        );

        let instruction =
            build_add_to_blacklist_instruction(&self.ctx, &address_pubkey, reason);

        match self.ctx.send_transaction(vec![instruction]).await {
            Ok(signature) => {
                tracing::info!(op_id = %id, signature = %signature, "Blacklist add confirmed");
                op.status = ComplianceStatus::Completed;
                op.signature = Some(signature);
                op.completed_at = Some(Utc::now().to_rfc3339());
            }
            Err(e) => {
                tracing::error!(op_id = %id, error = %e, "Blacklist add failed");
                op.status = ComplianceStatus::Failed;
                op.error = Some(e.to_string());
                op.completed_at = Some(Utc::now().to_rfc3339());
                self.operations.write().await.insert(id, op.clone());
                return Err(e);
            }
        }

        self.operations.write().await.insert(id, op.clone());
        Ok(op)
    }

    /// Remove an address from the on-chain blacklist.
    ///
    /// Builds a `remove_from_blacklist` instruction, signs and sends the transaction.
    /// The service keypair must hold an active Blacklister role. Rent from the closed
    /// BlacklistEntry PDA is returned to the service keypair.
    pub async fn remove_from_blacklist(
        &self,
        address: &str,
    ) -> Result<ComplianceOperation, AppError> {
        let address_pubkey = parse_pubkey(address)?;

        let id = Uuid::new_v4().to_string();
        let authority = self.ctx.keypair.pubkey().to_string();
        let mut op = ComplianceOperation {
            id: id.clone(),
            action: ComplianceAction::Unblacklist,
            address: address.to_string(),
            reason: None,
            status: ComplianceStatus::Executing,
            signature: None,
            error: None,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
            authority: authority.clone(),
        };

        self.operations.write().await.insert(id.clone(), op.clone());

        tracing::info!(
            op_id = %id,
            address = %address,
            authority = %authority,
            "Executing remove_from_blacklist"
        );

        let instruction =
            build_remove_from_blacklist_instruction(&self.ctx, &address_pubkey);

        match self.ctx.send_transaction(vec![instruction]).await {
            Ok(signature) => {
                tracing::info!(op_id = %id, signature = %signature, "Blacklist remove confirmed");
                op.status = ComplianceStatus::Completed;
                op.signature = Some(signature);
                op.completed_at = Some(Utc::now().to_rfc3339());
            }
            Err(e) => {
                tracing::error!(op_id = %id, error = %e, "Blacklist remove failed");
                op.status = ComplianceStatus::Failed;
                op.error = Some(e.to_string());
                op.completed_at = Some(Utc::now().to_rfc3339());
                self.operations.write().await.insert(id, op.clone());
                return Err(e);
            }
        }

        self.operations.write().await.insert(id, op.clone());
        Ok(op)
    }

    /// Check whether an address is currently on the blacklist.
    ///
    /// Derives the BlacklistEntry PDA and queries Solana RPC for its existence.
    /// Returns `true` if the account exists on-chain (address is blacklisted),
    /// `false` otherwise. Also records the check in the audit log.
    pub async fn check_blacklist(&self, address: &str) -> Result<bool, AppError> {
        let address_pubkey = parse_pubkey(address)?;

        let (blacklist_pda, _) = derive_blacklist_pda(
            &self.ctx.config_pda,
            &address_pubkey,
            &self.ctx.program_id,
        );

        let id = Uuid::new_v4().to_string();
        let authority = self.ctx.keypair.pubkey().to_string();

        tracing::info!(
            op_id = %id,
            address = %address,
            blacklist_pda = %blacklist_pda,
            "Checking blacklist status"
        );

        let exists = self
            .ctx
            .rpc
            .get_account(&blacklist_pda)
            .await
            .is_ok();

        let op = ComplianceOperation {
            id: id.clone(),
            action: ComplianceAction::Check,
            address: address.to_string(),
            reason: None,
            status: ComplianceStatus::Completed,
            signature: None,
            error: None,
            created_at: Utc::now().to_rfc3339(),
            completed_at: Some(Utc::now().to_rfc3339()),
            authority,
        };
        self.operations.write().await.insert(id, op);

        tracing::info!(
            address = %address,
            blacklisted = exists,
            "Blacklist check complete"
        );

        Ok(exists)
    }

    /// Retrieve a compliance operation by its UUID.
    pub async fn get_operation(&self, id: &str) -> Option<ComplianceOperation> {
        self.operations.read().await.get(id).cloned()
    }

    /// List recent compliance operations, newest first, limited to `limit` entries.
    pub async fn list_operations(&self, limit: usize) -> Vec<ComplianceOperation> {
        let ops = self.operations.read().await;
        let mut list: Vec<_> = ops.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list.truncate(limit);
        list
    }

    /// List only blacklist/unblacklist operations (excludes checks) as audit entries.
    pub async fn list_audit_log(&self, limit: usize) -> Vec<ComplianceOperation> {
        let ops = self.operations.read().await;
        let mut list: Vec<_> = ops
            .values()
            .filter(|op| op.action != ComplianceAction::Check)
            .cloned()
            .collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list.truncate(limit);
        list
    }

    /// Returns the service keypair's public key.
    pub fn service_pubkey(&self) -> String {
        self.ctx.keypair.pubkey().to_string()
    }

    /// Returns the stablecoin config PDA address.
    pub fn config_address(&self) -> String {
        self.ctx.config_pda.to_string()
    }

    /// Returns the SSS program ID.
    pub fn program_id(&self) -> String {
        self.ctx.program_id.to_string()
    }
}
