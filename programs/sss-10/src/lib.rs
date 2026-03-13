//! # SSS-10 — Async Mint/Redeem (CBDC-style request queue)
//!
//! Implements a two-phase mint/redeem workflow where every token issuance and
//! redemption passes through an authority-gated approval queue. This is the
//! canonical pattern for CBDC-style stablecoins and other regulated token
//! systems where compliance officers must review operations before execution.
//!
//! ## Workflow
//!
//! ### Minting
//! 1. Anyone calls [`request_mint`](sss_10::request_mint) → creates a
//!    [`MintRequest`](state::MintRequest) PDA with status `Pending`.
//! 2. Authority calls [`approve_mint`](sss_10::approve_mint) or
//!    [`reject_mint`](sss_10::reject_mint).
//! 3. If approved, anyone calls [`execute_mint`](sss_10::execute_mint) →
//!    marks the request `Executed`. The actual token mint is performed by
//!    the main SSS program, which reads the `Executed` PDA as proof of
//!    approval.
//! 4. The original requester may cancel a `Pending` request via
//!    [`cancel_mint_request`](sss_10::cancel_mint_request).
//!
//! ### Redemption
//! 1. Anyone calls [`request_redeem`](sss_10::request_redeem) → creates a
//!    [`RedeemRequest`](state::RedeemRequest) PDA with status `Pending`.
//! 2. Authority calls [`approve_redeem`](sss_10::approve_redeem).
//! 3. Anyone calls [`execute_redeem`](sss_10::execute_redeem) → transfers
//!    tokens from the requester's ATA into the async config's burn vault,
//!    then marks the request `Executed`.
//!
//! ## Checked Arithmetic
//!
//! All arithmetic uses `checked_add` / `checked_sub` and returns
//! [`AsyncError::MathOverflow`](error::AsyncError::MathOverflow) on overflow.

#![deny(clippy::all)]
// Anchor-generated code triggers these — safe to allow at crate level.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]
#![allow(clippy::result_large_err)]

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("HuuYq3UGPirYE42sJRcZuAb37rXeZU3THTgB7rorAaHu");

#[program]
pub mod sss_10 {
    use super::*;

    /// Initialize the async mint/redeem config for a given stablecoin.
    pub fn initialize_async_config(ctx: Context<InitializeAsyncConfig>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Submit a mint request with `Pending` status.
    pub fn request_mint(ctx: Context<RequestMint>, amount: u64, memo: String) -> Result<()> {
        instructions::request_mint::handler(ctx, amount, memo)
    }

    /// Approve a pending mint request. Authority only.
    pub fn approve_mint(ctx: Context<ApproveMint>, request_id: u64) -> Result<()> {
        instructions::approve_mint::handler(ctx, request_id)
    }

    /// Reject a pending mint request. Authority only.
    pub fn reject_mint(ctx: Context<RejectMint>, request_id: u64) -> Result<()> {
        instructions::reject_mint::handler(ctx, request_id)
    }

    /// Mark an approved mint request as executed. Callable by anyone.
    /// The actual token minting is performed by the SSS program using this
    /// PDA as proof of approval.
    pub fn execute_mint(ctx: Context<ExecuteMint>, request_id: u64) -> Result<()> {
        instructions::execute_mint::handler(ctx, request_id)
    }

    /// Cancel a pending mint request. Original requester only.
    pub fn cancel_mint_request(ctx: Context<CancelMintRequest>, request_id: u64) -> Result<()> {
        instructions::cancel_mint_request::handler(ctx, request_id)
    }

    /// Submit a redeem request with `Pending` status.
    pub fn request_redeem(ctx: Context<RequestRedeem>, amount: u64, memo: String) -> Result<()> {
        instructions::request_redeem::handler(ctx, amount, memo)
    }

    /// Approve a pending redeem request. Authority only.
    pub fn approve_redeem(ctx: Context<ApproveRedeem>, request_id: u64) -> Result<()> {
        instructions::approve_redeem::handler(ctx, request_id)
    }

    /// Execute an approved redeem request: transfer tokens to burn vault
    /// and mark the request as executed. Callable by anyone.
    pub fn execute_redeem(ctx: Context<ExecuteRedeem>, request_id: u64) -> Result<()> {
        instructions::execute_redeem::handler(ctx, request_id)
    }
}
