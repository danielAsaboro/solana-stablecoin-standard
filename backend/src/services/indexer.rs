//! Indexer service — fetch and index stablecoin events from on-chain transaction logs.
//!
//! Polls Solana RPC for new transactions involving the stablecoin config PDA,
//! parses Anchor event logs, and maintains an in-memory event index.

use std::sync::Arc;
use std::path::PathBuf;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use solana_client::rpc_client::GetConfirmedSignaturesForAddress2Config;
use solana_client::rpc_config::RpcTransactionConfig;
use solana_sdk::commitment_config::CommitmentConfig;
use solana_sdk::signature::Signature;
use solana_transaction_status::option_serializer::OptionSerializer;
use solana_transaction_status::UiTransactionEncoding;
use std::str::FromStr;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::error::AppError;
use crate::persistence::JsonFileStore;
use crate::services::webhook::{DispatchMetadata, WebhookService};
use crate::solana::SolanaContext;

// ── Event Type Constants ─────────────────────────────────────────────────

/// All 13 SSS program event type names.
const EVENT_NAMES: &[&str] = &[
    "StablecoinInitialized",
    "TokensMinted",
    "TokensBurned",
    "AccountFrozen",
    "AccountThawed",
    "StablecoinPaused",
    "StablecoinUnpaused",
    "RoleUpdated",
    "MinterQuotaUpdated",
    "AuthorityTransferred",
    "AddressBlacklisted",
    "AddressUnblacklisted",
    "TokensSeized",
];

/// Pre-computed 8-byte event discriminators for each SSS event type.
///
/// Anchor event discriminator formula: `sha256("event:<EventName>")[0..8]`
struct EventDiscriminator {
    name: &'static str,
    discriminator: [u8; 8],
}

/// Compute the Anchor event discriminator for a given event name.
fn compute_event_discriminator(event_name: &str) -> [u8; 8] {
    let mut hasher = Sha256::new();
    hasher.update(format!("event:{event_name}"));
    let hash = hasher.finalize();
    let mut disc = [0u8; 8];
    disc.copy_from_slice(&hash[..8]);
    disc
}

/// Build the full list of event discriminators at initialization time.
fn build_discriminators() -> Vec<EventDiscriminator> {
    EVENT_NAMES
        .iter()
        .map(|name| EventDiscriminator {
            name,
            discriminator: compute_event_discriminator(name),
        })
        .collect()
}

// ── Data Types ───────────────────────────────────────────────────────────

/// A single indexed on-chain event parsed from transaction logs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedEvent {
    /// Unique event identifier (UUID v4).
    pub id: String,
    /// The event type name (e.g. "TokensMinted", "TokensBurned").
    pub event_type: String,
    /// The transaction signature that emitted this event.
    pub signature: String,
    /// The slot in which the transaction was confirmed.
    pub slot: u64,
    /// Block timestamp (Unix seconds), if available.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<i64>,
    /// Parsed event data as JSON (raw base64 payload for unrecognized fields).
    pub data: serde_json::Value,
    /// ISO 8601 timestamp when this event was indexed locally.
    pub indexed_at: String,
}

/// Query filter for retrieving indexed events.
#[derive(Debug, Clone, Deserialize)]
pub struct EventFilter {
    /// Filter by event type name (e.g. "TokensMinted").
    pub event_type: Option<String>,
    /// Maximum number of events to return (default 100).
    pub limit: Option<usize>,
    /// Pagination cursor — return events before this transaction signature.
    pub before_signature: Option<String>,
}

// ── IndexerService ───────────────────────────────────────────────────────

/// Service for indexing on-chain stablecoin events from transaction logs.
///
/// Polls Solana RPC for transactions involving the config PDA, parses
/// Anchor event logs (`Program data: <base64>`), and stores events in
/// an in-memory index. Supports filtering and pagination for queries.
pub struct IndexerService {
    /// Shared Solana connectivity context.
    ctx: Arc<SolanaContext>,
    /// In-memory store of indexed events, newest first.
    events: RwLock<Vec<IndexedEvent>>,
    /// The last signature we processed, used as the `until` cursor for polling.
    last_signature: RwLock<Option<Signature>>,
    /// Pre-computed event discriminators for fast matching.
    discriminators: Vec<EventDiscriminator>,
    /// Optional local JSON persistence store.
    store: Option<JsonFileStore>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct PersistedIndexerState {
    events: Vec<IndexedEvent>,
    last_signature: Option<String>,
}

impl IndexerService {
    /// Create a new indexer service with the given Solana context.
    pub fn new(ctx: Arc<SolanaContext>) -> Self {
        Self {
            ctx,
            events: RwLock::new(Vec::new()),
            last_signature: RwLock::new(None),
            discriminators: build_discriminators(),
            store: None,
        }
    }

    /// Create a new indexer backed by a local JSON persistence file.
    pub fn with_persistence(
        ctx: Arc<SolanaContext>,
        path: impl Into<PathBuf>,
    ) -> Result<Self, AppError> {
        let store = JsonFileStore::new(path)?;
        let persisted: PersistedIndexerState = store.load_or_default()?;
        let last_signature = match persisted.last_signature {
            Some(signature) => Some(Signature::from_str(&signature).map_err(|e| {
                AppError::Internal(format!(
                    "Invalid persisted indexer cursor '{signature}': {e}"
                ))
            })?),
            None => None,
        };

        Ok(Self {
            ctx,
            events: RwLock::new(persisted.events),
            last_signature: RwLock::new(last_signature),
            discriminators: build_discriminators(),
            store: Some(store),
        })
    }

    /// Poll for new on-chain events since the last indexed signature.
    ///
    /// Fetches recent transaction signatures for the config PDA, retrieves
    /// each transaction's logs, parses Anchor event data, and stores new
    /// events in the in-memory index.
    ///
    /// Returns the number of newly indexed events.
    pub async fn poll_new_events(&self) -> Result<usize, AppError> {
        Ok(self.poll_new_events_internal().await?.len())
    }

    /// Poll for new on-chain events and dispatch exact-correlation webhooks.
    pub async fn poll_new_events_with_webhooks(
        &self,
        webhook: &Arc<WebhookService>,
    ) -> Result<usize, AppError> {
        let new_events = self.poll_new_events_internal().await?;

        for event in &new_events {
            webhook
                .dispatch_event_with_context(
                    &event.event_type,
                    event.data.clone(),
                    DispatchMetadata {
                        correlation_id: Some(format!("tx:{}", event.signature)),
                        transaction_signature: Some(event.signature.clone()),
                        event_id: Some(event.id.clone()),
                    },
                )
                .await;
        }

        Ok(new_events.len())
    }

    async fn poll_new_events_internal(&self) -> Result<Vec<IndexedEvent>, AppError> {
        let until = self.last_signature.read().await.as_ref().cloned();

        let config = GetConfirmedSignaturesForAddress2Config {
            before: None,
            until,
            limit: Some(100),
            commitment: Some(CommitmentConfig::confirmed()),
        };

        let signatures = self
            .ctx
            .rpc
            .get_signatures_for_address_with_config(&self.ctx.config_pda, config)
            .await
            .map_err(|e| AppError::SolanaRpc(format!("Failed to get signatures: {e}")))?;

        if signatures.is_empty() {
            return Ok(Vec::new());
        }

        tracing::info!(
            count = signatures.len(),
            config_pda = %self.ctx.config_pda,
            "Fetched transaction signatures for indexing"
        );

        // Signatures come newest-first from the RPC. We process oldest-first
        // so that `last_signature` always tracks the most recent processed tx.
        let mut sig_list: Vec<_> = signatures
            .iter()
            .filter(|s| s.err.is_none()) // skip failed transactions
            .collect();
        sig_list.reverse();

        let mut new_events: Vec<IndexedEvent> = Vec::new();

        for sig_info in &sig_list {
            let sig = Signature::from_str(&sig_info.signature).map_err(|e| {
                AppError::Internal(format!(
                    "Invalid signature '{}': {e}",
                    sig_info.signature
                ))
            })?;

            let tx_config = RpcTransactionConfig {
                encoding: Some(UiTransactionEncoding::Json),
                commitment: Some(CommitmentConfig::confirmed()),
                max_supported_transaction_version: Some(0),
            };

            let tx = match self
                .ctx
                .rpc
                .get_transaction_with_config(&sig, tx_config)
                .await
            {
                Ok(tx) => tx,
                Err(e) => {
                    tracing::error!(
                        signature = %sig_info.signature,
                        error = %e,
                        "Failed to fetch transaction, skipping"
                    );
                    continue;
                }
            };

            let log_messages = match &tx.transaction.meta {
                Some(meta) => match &meta.log_messages {
                    OptionSerializer::Some(logs) => logs.clone(),
                    _ => Vec::new(),
                },
                None => Vec::new(),
            };

            let parsed = self.parse_events_from_logs(
                &log_messages,
                &sig_info.signature,
                tx.slot,
                sig_info.block_time,
            );

            new_events.extend(parsed);
        }

        let indexed_events = new_events.clone();
        let new_count = indexed_events.len();

        if new_count > 0 {
            // Update last_signature to the newest processed signature (last in
            // our reversed list = originally first from RPC = newest).
            if let Some(newest) = sig_list.last() {
                let sig = Signature::from_str(&newest.signature).map_err(|e| {
                    AppError::Internal(format!(
                        "Invalid signature '{}': {e}",
                        newest.signature
                    ))
                })?;
                *self.last_signature.write().await = Some(sig);
            }

            let mut events = self.events.write().await;
            // Prepend new events (newest first) to maintain descending order.
            new_events.reverse();
            let mut combined = new_events;
            combined.append(&mut *events);
            *events = combined;

            tracing::info!(
                new_events = new_count,
                total_events = events.len(),
                "Indexed new events"
            );
            drop(events);
            self.persist_state().await;
        } else if let Some(newest) = sig_list.last() {
            // Even if no events were parsed, update cursor so we don't re-scan
            // the same transactions.
            let sig = Signature::from_str(&newest.signature).map_err(|e| {
                AppError::Internal(format!(
                    "Invalid signature '{}': {e}",
                    newest.signature
                ))
            })?;
            *self.last_signature.write().await = Some(sig);
            self.persist_state().await;
        }

        Ok(indexed_events)
    }

    /// Parse Anchor event logs from a transaction's log messages.
    ///
    /// Anchor emits events as `Program data: <base64>` log lines. The first
    /// 8 bytes of the decoded data are the event discriminator
    /// (`sha256("event:<EventName>")[0..8]`), and the remaining bytes are
    /// Borsh-serialized event fields.
    fn parse_events_from_logs(
        &self,
        logs: &[String],
        signature: &str,
        slot: u64,
        block_time: Option<i64>,
    ) -> Vec<IndexedEvent> {
        let mut events = Vec::new();
        let program_id_str = self.ctx.program_id.to_string();

        // Track whether we are inside the SSS program's log scope.
        // Anchor logs are emitted within `Program <id> invoke` / `Program <id> success` blocks.
        let mut in_program_scope = false;

        for log in logs {
            if log.contains(&format!("Program {program_id_str} invoke")) {
                in_program_scope = true;
                continue;
            }
            if log.contains(&format!("Program {program_id_str} success"))
                || log.contains(&format!("Program {program_id_str} failed"))
            {
                in_program_scope = false;
                continue;
            }

            if !in_program_scope {
                continue;
            }

            // Anchor event format: "Program data: <base64>"
            let prefix = "Program data: ";
            if let Some(b64_data) = log.strip_prefix(prefix) {
                let decoded = match BASE64.decode(b64_data.trim()) {
                    Ok(d) => d,
                    Err(e) => {
                        tracing::error!(
                            signature = %signature,
                            error = %e,
                            "Failed to decode base64 event data, skipping"
                        );
                        continue;
                    }
                };

                if decoded.len() < 8 {
                    continue;
                }

                let mut disc = [0u8; 8];
                disc.copy_from_slice(&decoded[..8]);

                if let Some(event_name) = self.match_discriminator(&disc) {
                    let remaining = &decoded[8..];
                    let data = build_event_data(event_name, remaining);

                    events.push(IndexedEvent {
                        id: Uuid::new_v4().to_string(),
                        event_type: event_name.to_string(),
                        signature: signature.to_string(),
                        slot,
                        timestamp: block_time,
                        data,
                        indexed_at: Utc::now().to_rfc3339(),
                    });
                }
            }
        }

        events
    }

    /// Match a discriminator against the known SSS event discriminators.
    ///
    /// Returns the event name if a match is found.
    fn match_discriminator(&self, disc: &[u8; 8]) -> Option<&'static str> {
        for ed in &self.discriminators {
            if ed.discriminator == *disc {
                return Some(ed.name);
            }
        }
        None
    }

    /// Retrieve indexed events with optional filtering and pagination.
    pub async fn get_events(&self, filter: EventFilter) -> Vec<IndexedEvent> {
        let events = self.events.read().await;
        let limit = filter.limit.unwrap_or(100).min(1000);

        let mut iter: Box<dyn Iterator<Item = &IndexedEvent>> = Box::new(events.iter());

        // Apply before_signature pagination: skip events until we find the cursor.
        if let Some(ref before_sig) = filter.before_signature {
            let mut found = false;
            let filtered: Vec<&IndexedEvent> = events
                .iter()
                .filter(|e| {
                    if found {
                        return true;
                    }
                    if e.signature == *before_sig {
                        found = true;
                    }
                    false
                })
                .collect();
            let owned: Vec<IndexedEvent> = filtered.into_iter().cloned().collect();
            drop(iter);

            let mut result: Vec<IndexedEvent> = if let Some(ref event_type) = filter.event_type {
                owned
                    .into_iter()
                    .filter(|e| e.event_type == *event_type)
                    .take(limit)
                    .collect()
            } else {
                owned.into_iter().take(limit).collect()
            };

            result.truncate(limit);
            return result;
        }

        // Apply event_type filter.
        if let Some(ref event_type) = filter.event_type {
            let et = event_type.clone();
            iter = Box::new(events.iter().filter(move |e| e.event_type == et));
        }

        iter.take(limit).cloned().collect()
    }

    /// Return the total number of indexed events.
    pub async fn get_event_count(&self) -> usize {
        self.events.read().await.len()
    }

    /// Return the slot of the most recently indexed event, if any.
    pub async fn get_latest_slot(&self) -> Option<u64> {
        self.events.read().await.first().map(|e| e.slot)
    }

    /// Start a background polling loop that indexes new events periodically.
    ///
    /// Spawns a tokio task that calls [`poll_new_events`](Self::poll_new_events)
    /// every `interval_secs` seconds. Errors are logged but do not stop the loop.
    pub fn start_polling(self: Arc<Self>, interval_secs: u64) {
        tracing::info!(
            interval_secs = interval_secs,
            config_pda = %self.ctx.config_pda,
            "Starting indexer background polling"
        );

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(
                std::time::Duration::from_secs(interval_secs),
            );

            loop {
                interval.tick().await;

                match self.poll_new_events().await {
                    Ok(count) => {
                        if count > 0 {
                            tracing::info!(
                                new_events = count,
                                "Indexer poll completed"
                            );
                        }
                    }
                    Err(e) => {
                        tracing::error!(
                            error = %e,
                            "Indexer poll failed"
                        );
                    }
                }
            }
        });
    }

    /// Start a background polling loop that indexes events and dispatches webhooks.
    pub fn start_polling_with_webhooks(
        self: Arc<Self>,
        webhook: Arc<WebhookService>,
        interval_secs: u64,
    ) {
        tracing::info!(
            interval_secs = interval_secs,
            config_pda = %self.ctx.config_pda,
            "Starting indexer background polling with webhook dispatch"
        );

        tokio::spawn(async move {
            let mut interval = tokio::time::interval(
                std::time::Duration::from_secs(interval_secs),
            );

            loop {
                interval.tick().await;

                match self.poll_new_events_with_webhooks(&webhook).await {
                    Ok(count) => {
                        if count > 0 {
                            tracing::info!(
                                new_events = count,
                                "Indexer poll completed"
                            );
                        }
                    }
                    Err(error) => {
                        tracing::error!(
                            error = %error,
                            "Indexer poll failed"
                        );
                    }
                }
            }
        });
    }

    /// Returns the config PDA address being indexed.
    pub fn config_address(&self) -> String {
        self.ctx.config_pda.to_string()
    }

    /// Returns the SSS program ID.
    pub fn program_id(&self) -> String {
        self.ctx.program_id.to_string()
    }

    async fn persist_state(&self) {
        let Some(store) = &self.store else {
            return;
        };

        let snapshot = {
            let events = self.events.read().await;
            let last_signature = self
                .last_signature
                .read()
                .await
                .as_ref()
                .map(ToString::to_string);
            PersistedIndexerState {
                events: events.clone(),
                last_signature,
            }
        };

        if let Err(e) = store.save(&snapshot) {
            tracing::error!(
                error = %e,
                path = %store.path().display(),
                "Failed to persist indexer state"
            );
        }
    }
}

// ── Event Data Helpers ───────────────────────────────────────────────────

/// Build a JSON `Value` representing the event data.
///
/// For known event types, attempts to extract Borsh-serialized fields
/// matching the on-chain Anchor event struct layouts. Falls back to a
/// JSON object with the raw hex payload if parsing fails.
fn build_event_data(event_name: &str, borsh_data: &[u8]) -> serde_json::Value {
    match event_name {
        "TokensMinted" => parse_tokens_minted(borsh_data),
        "TokensBurned" => parse_tokens_burned(borsh_data),
        "AccountFrozen" => parse_account_frozen_thawed(borsh_data),
        "AccountThawed" => parse_account_frozen_thawed(borsh_data),
        "StablecoinPaused" | "StablecoinUnpaused" => parse_pause_event(borsh_data),
        "RoleUpdated" => parse_role_updated(borsh_data),
        "MinterQuotaUpdated" => parse_minter_quota_updated(borsh_data),
        "AuthorityTransferred" => parse_authority_transferred(borsh_data),
        "AddressBlacklisted" => parse_address_blacklisted(borsh_data),
        "AddressUnblacklisted" => parse_address_unblacklisted(borsh_data),
        "TokensSeized" => parse_tokens_seized(borsh_data),
        "StablecoinInitialized" => parse_stablecoin_initialized(borsh_data),
        _ => raw_hex_data(borsh_data),
    }
}

/// Parse `TokensMinted { config, minter, recipient, amount, minter_total_minted }`.
///
/// Borsh layout: config(32) + minter(32) + recipient(32) + amount(8) + minter_total_minted(8) = 112 bytes
fn parse_tokens_minted(data: &[u8]) -> serde_json::Value {
    if data.len() < 112 {
        return raw_hex_data(data);
    }
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "minter": bs58_encode(&data[32..64]),
        "recipient": bs58_encode(&data[64..96]),
        "amount": read_u64(&data[96..104]),
        "minter_total_minted": read_u64(&data[104..112]),
    })
}

/// Parse `TokensBurned { config, burner, from, amount }`.
///
/// Borsh layout: config(32) + burner(32) + from(32) + amount(8) = 104 bytes
fn parse_tokens_burned(data: &[u8]) -> serde_json::Value {
    if data.len() < 104 {
        return raw_hex_data(data);
    }
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "burner": bs58_encode(&data[32..64]),
        "from": bs58_encode(&data[64..96]),
        "amount": read_u64(&data[96..104]),
    })
}

/// Parse `AccountFrozen/AccountThawed { config, authority, account }`.
///
/// Borsh layout: config(32) + authority(32) + account(32) = 96 bytes
fn parse_account_frozen_thawed(data: &[u8]) -> serde_json::Value {
    if data.len() < 96 {
        return raw_hex_data(data);
    }
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "authority": bs58_encode(&data[32..64]),
        "account": bs58_encode(&data[64..96]),
    })
}

/// Parse `StablecoinPaused/StablecoinUnpaused { config, authority }`.
///
/// Borsh layout: config(32) + authority(32) = 64 bytes
fn parse_pause_event(data: &[u8]) -> serde_json::Value {
    if data.len() < 64 {
        return raw_hex_data(data);
    }
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "authority": bs58_encode(&data[32..64]),
    })
}

/// Parse `RoleUpdated { config, user, role_type, active, updated_by }`.
///
/// Borsh layout: config(32) + user(32) + role_type(1) + active(1) + updated_by(32) = 98 bytes
fn parse_role_updated(data: &[u8]) -> serde_json::Value {
    if data.len() < 98 {
        return raw_hex_data(data);
    }
    let role = data[64];
    let role_name = match role {
        0 => "Minter",
        1 => "Burner",
        2 => "Pauser",
        3 => "Blacklister",
        4 => "Seizer",
        _ => "Unknown",
    };
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "user": bs58_encode(&data[32..64]),
        "role_type": role,
        "role_name": role_name,
        "active": data[65] != 0,
        "updated_by": bs58_encode(&data[66..98]),
    })
}

/// Parse `MinterQuotaUpdated { config, minter, new_quota, updated_by }`.
///
/// Borsh layout: config(32) + minter(32) + new_quota(8) + updated_by(32) = 104 bytes
fn parse_minter_quota_updated(data: &[u8]) -> serde_json::Value {
    if data.len() < 104 {
        return raw_hex_data(data);
    }
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "minter": bs58_encode(&data[32..64]),
        "new_quota": read_u64(&data[64..72]),
        "updated_by": bs58_encode(&data[72..104]),
    })
}

/// Parse `AuthorityTransferred { config, previous_authority, new_authority }`.
///
/// Borsh layout: config(32) + previous_authority(32) + new_authority(32) = 96 bytes
fn parse_authority_transferred(data: &[u8]) -> serde_json::Value {
    if data.len() < 96 {
        return raw_hex_data(data);
    }
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "previous_authority": bs58_encode(&data[32..64]),
        "new_authority": bs58_encode(&data[64..96]),
    })
}

/// Parse `AddressBlacklisted { config, address, reason, blacklisted_by }`.
///
/// Borsh layout: config(32) + address(32) + reason_len(4) + reason(var) + blacklisted_by(32)
fn parse_address_blacklisted(data: &[u8]) -> serde_json::Value {
    // Minimum: config(32) + address(32) + reason_len(4) + blacklisted_by(32) = 100
    if data.len() < 100 {
        return raw_hex_data(data);
    }
    let reason_len = read_u32(&data[64..68]) as usize;
    let reason_end = 68_usize.saturating_add(reason_len);
    let reason = if data.len() >= reason_end {
        String::from_utf8_lossy(&data[68..reason_end]).to_string()
    } else {
        String::new()
    };
    let blacklisted_by = if data.len() >= reason_end.saturating_add(32) {
        bs58_encode(&data[reason_end..reason_end.saturating_add(32)])
    } else {
        String::new()
    };
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "address": bs58_encode(&data[32..64]),
        "reason": reason,
        "blacklisted_by": blacklisted_by,
    })
}

/// Parse `AddressUnblacklisted { config, address, removed_by }`.
///
/// Borsh layout: config(32) + address(32) + removed_by(32) = 96 bytes
fn parse_address_unblacklisted(data: &[u8]) -> serde_json::Value {
    if data.len() < 96 {
        return raw_hex_data(data);
    }
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "address": bs58_encode(&data[32..64]),
        "removed_by": bs58_encode(&data[64..96]),
    })
}

/// Parse `TokensSeized { config, from, to, amount, seized_by }`.
///
/// Borsh layout: config(32) + from(32) + to(32) + amount(8) + seized_by(32) = 136 bytes
fn parse_tokens_seized(data: &[u8]) -> serde_json::Value {
    if data.len() < 136 {
        return raw_hex_data(data);
    }
    serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "from": bs58_encode(&data[32..64]),
        "to": bs58_encode(&data[64..96]),
        "amount": read_u64(&data[96..104]),
        "seized_by": bs58_encode(&data[104..136]),
    })
}

/// Parse `StablecoinInitialized { config, mint, authority, name, symbol, decimals, ... }`.
///
/// Borsh layout: config(32) + mint(32) + authority(32) + name(4+var) + symbol(4+var) + ...
/// We extract the first three fixed Pubkey fields; name/symbol are variable-length.
fn parse_stablecoin_initialized(data: &[u8]) -> serde_json::Value {
    if data.len() < 96 {
        return raw_hex_data(data);
    }
    let mut result = serde_json::json!({
        "config": bs58_encode(&data[0..32]),
        "mint": bs58_encode(&data[32..64]),
        "authority": bs58_encode(&data[64..96]),
    });

    // Try to parse the name string (4-byte length prefix + UTF-8 data).
    if data.len() > 100 {
        let name_len = read_u32(&data[96..100]) as usize;
        let name_end = 100_usize.saturating_add(name_len);
        if data.len() >= name_end {
            let name = String::from_utf8_lossy(&data[100..name_end]).to_string();
            result["name"] = serde_json::Value::String(name);

            // Try to parse the symbol string.
            if data.len() > name_end.saturating_add(4) {
                let sym_len = read_u32(&data[name_end..name_end.saturating_add(4)]) as usize;
                let sym_end = name_end.saturating_add(4).saturating_add(sym_len);
                if data.len() >= sym_end {
                    let symbol = String::from_utf8_lossy(
                        &data[name_end.saturating_add(4)..sym_end],
                    )
                    .to_string();
                    result["symbol"] = serde_json::Value::String(symbol);

                    // Try to parse decimals (1 byte after symbol).
                    if data.len() > sym_end {
                        result["decimals"] = serde_json::json!(data[sym_end]);
                    }
                }
            }
        }
    }

    result
}

/// Read a little-endian u64 from an 8-byte slice.
fn read_u64(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[..8].try_into().unwrap_or([0u8; 8]))
}

/// Read a little-endian u32 from a 4-byte slice.
fn read_u32(data: &[u8]) -> u32 {
    u32::from_le_bytes(data[..4].try_into().unwrap_or([0u8; 4]))
}

/// Encode raw bytes as a base58 string (for Pubkey rendering).
fn bs58_encode(bytes: &[u8]) -> String {
    bs58::encode(bytes).into_string()
}

/// Fallback: wrap raw Borsh bytes as hex in a JSON object.
fn raw_hex_data(data: &[u8]) -> serde_json::Value {
    serde_json::json!({
        "raw_hex": hex::encode(data),
    })
}
