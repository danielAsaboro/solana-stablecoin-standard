//! # SSS Privacy Module
//!
//! Allowlist management for Token-2022 confidential transfers on SSS-3
//! privacy-enabled stablecoins.
//!
//! ## Architecture
//!
//! The privacy module is a **separate Anchor program** that manages an allowlist
//! of addresses permitted to participate in Token-2022 confidential transfers.
//! The SSS stablecoin program itself is unchanged — the privacy module is a
//! companion program that maintains a per-stablecoin allowlist.
//!
//! ```text
//! ┌──────────────────┐     linked to    ┌──────────────────┐
//! │  SSS Stablecoin  │ ◄──────────────  │  Privacy Program  │
//! │  Config (PDA)    │                  │  (PrivacyConfig)  │
//! └──────────────────┘                  └────────┬─────────┘
//!                                                │ manages
//!                                       ┌────────▼─────────┐
//!                                       │  AllowlistEntry   │
//!                                       │  PDAs (per-addr)  │
//!                                       └────────┬─────────┘
//!                                                │ queried by
//!                                ┌───────────────┴───────────────┐
//!                                │                               │
//!                       ┌────────▼────────┐            ┌────────▼────────┐
//!                       │  Backend / SDK  │            │    Frontend     │
//!                       │ (check before   │            │  (display       │
//!                       │  conf. transfer)│            │   allowlist)    │
//!                       └─────────────────┘            └─────────────────┘
//! ```
//!
//! ## Allowlist Model
//!
//! Each [`PrivacyConfig`](state::PrivacyConfig) PDA can operate in two modes:
//!
//! - **Auto-approve** (`auto_approve = true`): All addresses are implicitly
//!   allowed. The allowlist is informational only.
//! - **Explicit allowlist** (`auto_approve = false`): Only addresses with a
//!   corresponding [`AllowlistEntry`](state::AllowlistEntry) PDA may participate
//!   in confidential transfers.
//!
//! ## Checked Arithmetic
//!
//! All arithmetic operations use `checked_*` methods and return
//! [`PrivacyError::MathOverflow`](error::PrivacyError::MathOverflow) on overflow.

#![deny(clippy::all)]
// Anchor-generated code triggers these — safe to allow at crate level.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]
#![allow(clippy::result_large_err)]

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk");

#[program]
pub mod sss_privacy {
    use super::*;

    /// Initialize a new privacy configuration linked to an SSS stablecoin.
    ///
    /// Creates a [`PrivacyConfig`](crate::state::PrivacyConfig) PDA that manages
    /// the confidential transfer allowlist for the specified stablecoin.
    pub fn initialize_privacy(
        ctx: Context<InitializePrivacy>,
        params: InitializePrivacyParams,
    ) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Update privacy configuration. Authority only.
    ///
    /// Allows the privacy authority to modify settings such as `auto_approve`.
    pub fn update_privacy_config(
        ctx: Context<UpdatePrivacyConfig>,
        params: UpdatePrivacyConfigParams,
    ) -> Result<()> {
        instructions::update_config::handler(ctx, params)
    }

    /// Add an address to the confidential transfer allowlist. Authority only.
    ///
    /// Creates a new [`AllowlistEntry`](crate::state::AllowlistEntry) PDA for the
    /// specified address and increments the allowlist count.
    pub fn add_to_allowlist(
        ctx: Context<AddToAllowlist>,
        params: AddToAllowlistParams,
    ) -> Result<()> {
        instructions::add_to_allowlist::handler(ctx, params)
    }

    /// Remove an address from the confidential transfer allowlist. Authority only.
    ///
    /// Closes the [`AllowlistEntry`](crate::state::AllowlistEntry) PDA, reclaiming
    /// rent, and decrements the allowlist count.
    pub fn remove_from_allowlist(ctx: Context<RemoveFromAllowlist>) -> Result<()> {
        instructions::remove_from_allowlist::handler(ctx)
    }
}
