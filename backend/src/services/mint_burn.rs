//! Mint and burn service — executes on-chain token operations via Solana RPC.
//!
//! Builds Anchor-compatible instructions, signs with the configured service
//! keypair, sends transactions, and tracks operation status in memory.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use solana_sdk::signer::Signer;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::AppError;
use crate::persistence::JsonFileStore;
use crate::services::cache::CacheBackend;
use crate::solana::{
    build_burn_instruction, build_mint_instruction, get_associated_token_address, parse_pubkey,
    SolanaContext,
};

/// Lifecycle status of a mint or burn operation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum OperationStatus {
    /// Operation received, building transaction
    Pending,
    /// Transaction sent, awaiting confirmation
    Executing,
    /// Transaction confirmed on-chain
    Completed,
    /// Transaction failed (see `error` field for details)
    Failed,
}

/// A tracked mint or burn operation with full lifecycle metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MintBurnOperation {
    /// Unique operation identifier (UUID v4)
    pub id: String,
    /// Operation type: "mint" or "burn"
    pub operation_type: String,
    /// Token amount (in base units, e.g. lamports for 6-decimal tokens)
    pub amount: u64,
    /// Target address (recipient for mint, source for burn)
    pub target: String,
    /// The authority that submitted the operation.
    pub authority: String,
    /// Current operation status
    pub status: OperationStatus,
    /// Solana transaction signature (set on completion)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// Error message (set on failure)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// ISO 8601 timestamp when the operation was created
    pub created_at: String,
    /// ISO 8601 timestamp when the operation completed or failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
}

/// Service for executing mint and burn operations against the on-chain SSS program.
///
/// Holds a shared reference to the [`SolanaContext`] for RPC access and keypair
/// signing. Tracks all operations in an in-memory store for status queries.
pub struct MintBurnService {
    ctx: Arc<SolanaContext>,
    operations: RwLock<HashMap<String, MintBurnOperation>>,
    store: Option<CacheBackend>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedMintBurnState {
    operations: HashMap<String, MintBurnOperation>,
}

impl MintBurnService {
    /// Create a new service with the given Solana context.
    pub fn new(ctx: Arc<SolanaContext>) -> Self {
        Self {
            ctx,
            operations: RwLock::new(HashMap::new()),
            store: None,
        }
    }

    /// Create a new service backed by a local JSON persistence file.
    pub fn with_persistence(
        ctx: Arc<SolanaContext>,
        path: impl Into<PathBuf>,
    ) -> Result<Self, AppError> {
        let store = JsonFileStore::new(path)?;
        let persisted: PersistedMintBurnState = store.load_or_default()?;
        Ok(Self {
            ctx,
            operations: RwLock::new(persisted.operations),
            store: Some(CacheBackend::File(store)),
        })
    }

    /// Create a new service backed by a cache backend (file or Redis).
    pub async fn with_cache(
        ctx: Arc<SolanaContext>,
        backend: CacheBackend,
    ) -> Result<Self, AppError> {
        let persisted: PersistedMintBurnState = backend.load().await?;
        Ok(Self {
            ctx,
            operations: RwLock::new(persisted.operations),
            store: Some(backend),
        })
    }

    /// Mint tokens to a recipient wallet address.
    ///
    /// Derives the recipient's Associated Token Account, builds a `mint_tokens`
    /// instruction, signs and sends the transaction, then tracks the operation.
    ///
    /// The service keypair must hold an active Minter role with sufficient quota.
    pub async fn mint(&self, recipient: &str, amount: u64) -> Result<MintBurnOperation, AppError> {
        if amount == 0 {
            return Err(AppError::InvalidInput(
                "Amount must be greater than zero".to_string(),
            ));
        }

        let recipient_pubkey = parse_pubkey(recipient)?;
        let recipient_ata = get_associated_token_address(&recipient_pubkey, &self.ctx.mint);

        let id = Uuid::new_v4().to_string();
        let mut op = MintBurnOperation {
            id: id.clone(),
            operation_type: "mint".to_string(),
            amount,
            target: recipient.to_string(),
            authority: self.ctx.keypair.pubkey().to_string(),
            status: OperationStatus::Executing,
            signature: None,
            error: None,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
        };

        self.operations.write().await.insert(id.clone(), op.clone());
        self.persist_state().await;

        tracing::info!(
            op_id = %id,
            recipient = %recipient,
            recipient_ata = %recipient_ata,
            amount = amount,
            minter = %self.ctx.keypair.pubkey(),
            "Executing mint operation"
        );

        let instruction = build_mint_instruction(&self.ctx, &recipient_ata, amount);

        match self.ctx.send_transaction(vec![instruction]).await {
            Ok(signature) => {
                tracing::info!(op_id = %id, signature = %signature, "Mint confirmed");
                op.status = OperationStatus::Completed;
                op.signature = Some(signature);
                op.completed_at = Some(Utc::now().to_rfc3339());
            }
            Err(e) => {
                tracing::error!(op_id = %id, error = %e, "Mint failed");
                op.status = OperationStatus::Failed;
                op.error = Some(e.to_string());
                op.completed_at = Some(Utc::now().to_rfc3339());
                self.operations.write().await.insert(id, op.clone());
                self.persist_state().await;
                return Err(e);
            }
        }

        self.operations.write().await.insert(id, op.clone());
        self.persist_state().await;
        Ok(op)
    }

    /// Burn tokens from a token account.
    ///
    /// Accepts a token account address directly. The service keypair must be the
    /// owner of the token account (or have delegation) and hold an active Burner role.
    pub async fn burn(
        &self,
        from_account: &str,
        amount: u64,
    ) -> Result<MintBurnOperation, AppError> {
        if amount == 0 {
            return Err(AppError::InvalidInput(
                "Amount must be greater than zero".to_string(),
            ));
        }

        let from_pubkey = parse_pubkey(from_account)?;

        let id = Uuid::new_v4().to_string();
        let mut op = MintBurnOperation {
            id: id.clone(),
            operation_type: "burn".to_string(),
            amount,
            target: from_account.to_string(),
            authority: self.ctx.keypair.pubkey().to_string(),
            status: OperationStatus::Executing,
            signature: None,
            error: None,
            created_at: Utc::now().to_rfc3339(),
            completed_at: None,
        };

        self.operations.write().await.insert(id.clone(), op.clone());
        self.persist_state().await;

        tracing::info!(
            op_id = %id,
            from = %from_account,
            amount = amount,
            burner = %self.ctx.keypair.pubkey(),
            "Executing burn operation"
        );

        let instruction = build_burn_instruction(&self.ctx, &from_pubkey, amount);

        match self.ctx.send_transaction(vec![instruction]).await {
            Ok(signature) => {
                tracing::info!(op_id = %id, signature = %signature, "Burn confirmed");
                op.status = OperationStatus::Completed;
                op.signature = Some(signature);
                op.completed_at = Some(Utc::now().to_rfc3339());
            }
            Err(e) => {
                tracing::error!(op_id = %id, error = %e, "Burn failed");
                op.status = OperationStatus::Failed;
                op.error = Some(e.to_string());
                op.completed_at = Some(Utc::now().to_rfc3339());
                self.operations.write().await.insert(id, op.clone());
                self.persist_state().await;
                return Err(e);
            }
        }

        self.operations.write().await.insert(id, op.clone());
        self.persist_state().await;
        Ok(op)
    }

    /// Retrieve an operation by its UUID.
    pub async fn get_operation(&self, id: &str) -> Option<MintBurnOperation> {
        self.operations.read().await.get(id).cloned()
    }

    /// List recent operations, newest first, limited to `limit` entries.
    pub async fn list_operations(&self, limit: usize) -> Vec<MintBurnOperation> {
        let ops = self.operations.read().await;
        let mut list: Vec<_> = ops.values().cloned().collect();
        list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        list.truncate(limit);
        list
    }

    /// Returns the service keypair's public key (the address that signs transactions).
    pub fn service_pubkey(&self) -> String {
        self.ctx.keypair.pubkey().to_string()
    }

    /// Returns the stablecoin mint address.
    pub fn mint_address(&self) -> String {
        self.ctx.mint.to_string()
    }

    /// Returns the stablecoin config PDA address.
    pub fn config_address(&self) -> String {
        self.ctx.config_pda.to_string()
    }

    /// Returns the SSS program ID.
    pub fn program_id(&self) -> String {
        self.ctx.program_id.to_string()
    }

    async fn persist_state(&self) {
        let Some(backend) = &self.store else {
            return;
        };

        let snapshot = {
            let operations = self.operations.read().await;
            PersistedMintBurnState {
                operations: operations.clone(),
            }
        };

        if let Err(e) = backend.save(&snapshot).await {
            tracing::error!(error = %e, "Failed to persist mint/burn state");
        }
    }
}
