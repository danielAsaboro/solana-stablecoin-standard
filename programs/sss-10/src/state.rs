//! On-chain account state for the SSS-10 Async Mint/Redeem program.
//!
//! All accounts are PDAs with deterministic seeds. The [`AsyncConfig`] governs a
//! queue of [`MintRequest`] and [`RedeemRequest`] accounts, each representing a
//! pending or completed operation awaiting authority approval.

use anchor_lang::prelude::*;

/// Central configuration for the async mint/redeem queue.
///
/// Seeds: `["async_config", stablecoin_config]`
#[account]
pub struct AsyncConfig {
    /// The SSS [`StablecoinConfig`] PDA this async layer wraps.
    pub stablecoin_config: Pubkey,
    /// Who can approve or reject requests.
    pub authority: Pubkey,
    /// The Token-2022 mint address.
    pub mint: Pubkey,
    /// Monotonically increasing counter; used as the seed for request PDAs.
    pub total_requests: u64,
    /// PDA bump seed.
    pub bump: u8,
}

impl AsyncConfig {
    pub const LEN: usize = 8 + 32 + 32 + 32 + 8 + 1;
    pub const SEED_PREFIX: &'static [u8] = b"async_config";
}

/// Lifecycle state of a mint or redeem request.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum RequestStatus {
    Pending   = 0,
    Approved  = 1,
    Rejected  = 2,
    Executed  = 3,
    Cancelled = 4,
}

/// A queued request to mint tokens.
///
/// Created by anyone; approved/rejected by the [`AsyncConfig::authority`].
/// Once approved, it serves as an on-chain attestation that the main SSS
/// program may honour when performing the actual `mint_tokens` CPI.
///
/// Seeds: `["mint_request", async_config, request_id_le_bytes]`
#[account]
pub struct MintRequest {
    /// The [`AsyncConfig`] PDA this request belongs to.
    pub async_config: Pubkey,
    /// Unique monotonically increasing ID assigned at creation.
    pub request_id: u64,
    /// The signer who submitted the request.
    pub requester: Pubkey,
    /// Token account that should receive the minted tokens.
    pub recipient: Pubkey,
    /// Number of tokens (base units) to mint.
    pub amount: u64,
    /// Current lifecycle status.
    pub status: RequestStatus,
    /// Unix timestamp of creation.
    pub created_at: i64,
    /// Unix timestamp of last status update.
    pub updated_at: i64,
    /// Authority that approved this request (`Pubkey::default()` until approved).
    pub approved_by: Pubkey,
    /// Optional human-readable memo (max 128 chars).
    pub memo: String,
    /// PDA bump seed.
    pub bump: u8,
}

impl MintRequest {
    pub const LEN: usize = 8 + 32 + 8 + 32 + 32 + 8 + 1 + 8 + 8 + 32 + (4 + 128) + 1;
    pub const SEED_PREFIX: &'static [u8] = b"mint_request";
}

/// A queued request to redeem (burn) tokens.
///
/// Seeds: `["redeem_request", async_config, request_id_le_bytes]`
#[account]
pub struct RedeemRequest {
    /// The [`AsyncConfig`] PDA this request belongs to.
    pub async_config: Pubkey,
    /// Unique monotonically increasing ID assigned at creation.
    pub request_id: u64,
    /// The signer who submitted the request.
    pub requester: Pubkey,
    /// Token account from which tokens will be transferred/burned.
    pub source_token_account: Pubkey,
    /// Number of tokens (base units) to redeem.
    pub amount: u64,
    /// Current lifecycle status.
    pub status: RequestStatus,
    /// Unix timestamp of creation.
    pub created_at: i64,
    /// Unix timestamp of last status update.
    pub updated_at: i64,
    /// Authority that approved this request (`Pubkey::default()` until approved).
    pub approved_by: Pubkey,
    /// Optional human-readable memo (max 128 chars).
    pub memo: String,
    /// PDA bump seed.
    pub bump: u8,
}

impl RedeemRequest {
    pub const LEN: usize = 8 + 32 + 8 + 32 + 32 + 8 + 1 + 8 + 8 + 32 + (4 + 128) + 1;
    pub const SEED_PREFIX: &'static [u8] = b"redeem_request";
}
