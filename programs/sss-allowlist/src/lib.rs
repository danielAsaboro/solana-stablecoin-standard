//! # SSS Allowlist — Composable Access Control Module
//!
//! An Anchor program providing allowlist / blocklist access control for token
//! transfers as a composable module for the Solana Stablecoin Standard. The
//! SSS transfer hook program optionally reads an
//! [`AllowlistConfig`](state::AllowlistConfig) PDA from `remaining_accounts`
//! during transfer execution — if present and owned by this program, the
//! current [`AccessMode`](state::AccessMode) is enforced.
//!
//! ## Access modes
//!
//! | Mode        | Behaviour                                            |
//! |-------------|------------------------------------------------------|
//! | `Open`      | No restriction — all addresses may transfer freely.  |
//! | `Allowlist` | Only addresses with an `AllowlistEntry` PDA may transfer. |
//! | `Blocklist` | Addresses with an `AllowlistEntry` PDA are blocked.  |
//!
//! ## Integration pattern
//!
//! 1. Deploy this program alongside the transfer hook.
//! 2. Call [`initialize_allowlist_config`](sss_allowlist::initialize_allowlist_config)
//!    once per stablecoin.
//! 3. Add addresses with [`add_to_allowlist`](sss_allowlist::add_to_allowlist).
//! 4. In the transfer hook, include the [`AllowlistConfig`] PDA and the relevant
//!    [`AllowlistEntry`] PDA (or a system-program-owned account if not listed) in
//!    `extra_account_metas` so the hook can check listing status.
//!
//! ## Checked arithmetic
//!
//! All instructions use checked arithmetic and return
//! [`AllowlistError`](error::AllowlistError) on unexpected conditions.

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

// Program ID placeholder — replaced by `anchor build` keypair.
declare_id!("9fGAfF22iZ9GGmbhAJi48Q4ktMNqfeunuwBhy1fQT9hL");

#[program]
pub mod sss_allowlist {
    use super::*;

    /// Initialize a new [`AllowlistConfig`](state::AllowlistConfig) PDA for a
    /// stablecoin. The transaction signer becomes the authority.
    pub fn initialize_allowlist_config(
        ctx: Context<InitializeAllowlistConfig>,
        mode: state::AccessMode,
    ) -> Result<()> {
        instructions::initialize_allowlist_config::handler(ctx, mode)
    }

    /// Change the access mode on an existing [`AllowlistConfig`](state::AllowlistConfig).
    /// Requires the allowlist authority.
    pub fn update_allowlist_mode(
        ctx: Context<UpdateAllowlistMode>,
        mode: state::AccessMode,
    ) -> Result<()> {
        instructions::update_allowlist_mode::handler(ctx, mode)
    }

    /// Create an [`AllowlistEntry`](state::AllowlistEntry) PDA for `address`.
    /// Requires the allowlist authority. `label` must not exceed 32 characters.
    pub fn add_to_allowlist(
        ctx: Context<AddToAllowlist>,
        address: Pubkey,
        label: String,
    ) -> Result<()> {
        instructions::add_to_allowlist::handler(ctx, address, label)
    }

    /// Close the [`AllowlistEntry`](state::AllowlistEntry) PDA for `address`,
    /// returning rent to the authority. Requires the allowlist authority.
    pub fn remove_from_allowlist(
        ctx: Context<RemoveFromAllowlist>,
        address: Pubkey,
    ) -> Result<()> {
        instructions::remove_from_allowlist::handler(ctx, address)
    }
}
