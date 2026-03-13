//! # SSS Caps — Composable Supply Cap Module
//!
//! An Anchor program that manages global and per-minter supply caps as a
//! composable module for the Solana Stablecoin Standard. The main SSS program
//! optionally reads a [`CapsConfig`](state::CapsConfig) PDA from
//! `remaining_accounts` during minting — if the account is present and owned by
//! this program, the caps it encodes are enforced.
//!
//! ## Integration pattern
//!
//! 1. Deploy this program alongside the main SSS program.
//! 2. Call [`initialize_caps_config`](sss_caps::initialize_caps_config) once per
//!    stablecoin, passing the SSS [`StablecoinConfig`] pubkey.
//! 3. In your mint CPI, include the [`CapsConfig`] PDA in `remaining_accounts`.
//!    The SSS program will read `global_cap` and `per_minter_cap` and enforce
//!    them in addition to its own built-in supply cap.
//!
//! ## Checked arithmetic
//!
//! All instructions use checked arithmetic and return
//! [`CapsError`](error::CapsError) on unexpected conditions.

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
declare_id!("GAJnKyPuWWdW864jLUjUsGFuwjk5zyZYBqEYZQjQZDv5");

#[program]
pub mod sss_caps {
    use super::*;

    /// Initialize a new [`CapsConfig`](state::CapsConfig) PDA for a stablecoin.
    ///
    /// The transaction signer becomes the caps authority. Both caps may be set to
    /// `0` to indicate "unlimited" at initialization time.
    pub fn initialize_caps_config(
        ctx: Context<InitializeCapsConfig>,
        global_cap: u64,
        per_minter_cap: u64,
    ) -> Result<()> {
        instructions::initialize_caps_config::handler(ctx, global_cap, per_minter_cap)
    }

    /// Update the supply caps on an existing [`CapsConfig`](state::CapsConfig).
    ///
    /// Requires the caps authority signature. Rejects the update if the new caps
    /// are identical to the current ones.
    pub fn update_caps_config(
        ctx: Context<UpdateCapsConfig>,
        global_cap: u64,
        per_minter_cap: u64,
    ) -> Result<()> {
        instructions::update_caps_config::handler(ctx, global_cap, per_minter_cap)
    }
}
