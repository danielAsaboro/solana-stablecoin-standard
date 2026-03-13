//! Program events emitted by SSS-10 Async Mint/Redeem instructions.
//!
//! Every state-changing instruction emits exactly one event. Clients can parse
//! these from transaction logs to build an off-chain audit trail.

use anchor_lang::prelude::*;

/// Emitted when the async config is initialized.
#[event]
pub struct AsyncConfigInitialized {
    /// The newly created [`AsyncConfig`](crate::state::AsyncConfig) PDA.
    pub async_config: Pubkey,
    /// The stablecoin config this async layer wraps.
    pub stablecoin_config: Pubkey,
    /// The authority who initialized and will govern the queue.
    pub authority: Pubkey,
    /// The Token-2022 mint address.
    pub mint: Pubkey,
}

/// Emitted when a mint request is submitted.
#[event]
pub struct MintRequested {
    /// The async config PDA.
    pub async_config: Pubkey,
    /// Unique ID assigned to this request.
    pub request_id: u64,
    /// The address that submitted the request.
    pub requester: Pubkey,
    /// Token account that will receive the minted tokens if approved.
    pub recipient: Pubkey,
    /// Number of tokens requested.
    pub amount: u64,
}

/// Emitted when a mint request is approved by the authority.
#[event]
pub struct MintApproved {
    /// Unique ID of the approved request.
    pub request_id: u64,
    /// The authority that approved the request.
    pub approved_by: Pubkey,
}

/// Emitted when a mint request is rejected by the authority.
#[event]
pub struct MintRejected {
    /// Unique ID of the rejected request.
    pub request_id: u64,
    /// The authority that rejected the request.
    pub rejected_by: Pubkey,
}

/// Emitted when an approved mint request is executed.
#[event]
pub struct MintExecuted {
    /// Unique ID of the executed request.
    pub request_id: u64,
    /// Number of tokens that were minted.
    pub amount: u64,
}

/// Emitted when a pending mint request is cancelled by the requester.
#[event]
pub struct MintCancelled {
    /// Unique ID of the cancelled request.
    pub request_id: u64,
    /// The requester who cancelled.
    pub cancelled_by: Pubkey,
}

/// Emitted when a redeem request is submitted.
#[event]
pub struct RedeemRequested {
    /// The async config PDA.
    pub async_config: Pubkey,
    /// Unique ID assigned to this request.
    pub request_id: u64,
    /// The address that submitted the request.
    pub requester: Pubkey,
    /// Token account from which tokens will be redeemed.
    pub source_token_account: Pubkey,
    /// Number of tokens requested for redemption.
    pub amount: u64,
}

/// Emitted when a redeem request is approved by the authority.
#[event]
pub struct RedeemApproved {
    /// Unique ID of the approved request.
    pub request_id: u64,
    /// The authority that approved the request.
    pub approved_by: Pubkey,
}

/// Emitted when an approved redeem request is executed.
#[event]
pub struct RedeemExecuted {
    /// Unique ID of the executed request.
    pub request_id: u64,
    /// Number of tokens that were redeemed/burned.
    pub amount: u64,
}
