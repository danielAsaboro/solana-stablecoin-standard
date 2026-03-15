//! # Solana Stablecoin Standard (SSS) — Main Program
//!
//! A modular, configurable stablecoin program built on Token-2022. Supports two
//! opinionated presets:
//!
//! - **SSS-1 (Minimal):** Mint authority, freeze authority, metadata, role-based
//!   access control, per-minter quotas, and pause capability. Suitable for DAO
//!   treasuries, internal tokens, and ecosystem settlement.
//!
//! - **SSS-2 (Compliant):** SSS-1 plus permanent delegate (for seizure), transfer
//!   hook (for blacklist enforcement on every transfer), and blacklist management.
//!   Designed for regulated stablecoins (USDC/USDT-class) where on-chain compliance
//!   is mandatory.
//!
//! ## Security Model
//!
//! The [`StablecoinConfig`](state::StablecoinConfig) PDA owns the mint authority,
//! freeze authority, and (if enabled) serves as the permanent delegate. All privileged
//! operations require a valid [`RoleAccount`](state::RoleAccount) PDA with an active
//! role. The master authority can assign/revoke roles but cannot directly mint, burn,
//! or freeze — separation of duties is enforced at the protocol level.
//!
//! ## Checked Arithmetic
//!
//! All arithmetic operations use `checked_add` / `checked_sub` and return
//! [`StablecoinError::MathOverflow`](error::StablecoinError::MathOverflow) on overflow.

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

declare_id!("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu");

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "Solana Stablecoin Standard (SSS)",
    project_url: "https://github.com/solanabr/solana-stablecoin-standard",
    contacts: "email:security@example.com",
    policy: "https://github.com/solanabr/solana-stablecoin-standard/blob/main/SECURITY.md"
}

#[program]
pub mod sss {
    use super::*;

    /// Initialize a new stablecoin with Token-2022 extensions.
    /// SSS-1: basic mint with metadata.
    /// SSS-2: adds permanent delegate + transfer hook for compliance.
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Mint tokens to a recipient. Requires Minter role and available quota.
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint::handler(ctx, amount)
    }

    /// Burn tokens. Requires Burner role.
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn::handler(ctx, amount)
    }

    /// Freeze a token account. Requires Pauser role.
    pub fn freeze_token_account(ctx: Context<FreezeTokenAccount>) -> Result<()> {
        instructions::freeze_account::handler(ctx)
    }

    /// Thaw a frozen token account. Requires Pauser role.
    pub fn thaw_token_account(ctx: Context<ThawTokenAccount>) -> Result<()> {
        instructions::thaw_account::handler(ctx)
    }

    /// Pause the stablecoin (blocks minting and burning). Requires Pauser role.
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::handler(ctx)
    }

    /// Unpause the stablecoin. Requires Pauser role.
    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        instructions::unpause::handler(ctx)
    }

    /// Assign a new role to a user. Master authority only.
    pub fn assign_role(ctx: Context<AssignRole>, role_type: u8, user: Pubkey) -> Result<()> {
        instructions::assign_role::handler(ctx, role_type, user)
    }

    /// Activate or deactivate an existing role. Master authority only.
    pub fn update_role(
        ctx: Context<UpdateRole>,
        role_type: u8,
        user: Pubkey,
        active: bool,
    ) -> Result<()> {
        instructions::update_role::handler(ctx, role_type, user, active)
    }

    /// Set or update a minter's quota. Master authority only.
    pub fn update_minter(ctx: Context<UpdateMinter>, minter: Pubkey, quota: u64) -> Result<()> {
        instructions::update_minter::handler(ctx, minter, quota)
    }

    /// Reset a minter's cumulative `minted` counter to zero.
    /// Allows the minter to issue up to their full quota again. Master authority only.
    pub fn reset_minter_quota(ctx: Context<ResetMinterQuota>, minter: Pubkey) -> Result<()> {
        instructions::reset_minter_quota::handler(ctx, minter)
    }

    /// Transfer master authority to a new address (immediate, emergency path).
    pub fn transfer_authority(
        ctx: Context<TransferAuthority>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::transfer_authority::handler(ctx, new_authority)
    }

    /// Propose a 2-step authority transfer. The new authority must call
    /// `accept_authority_transfer` to complete the handoff.
    pub fn propose_authority_transfer(
        ctx: Context<ProposeAuthorityTransfer>,
        new_authority: Pubkey,
    ) -> Result<()> {
        instructions::propose_authority::handler(ctx, new_authority)
    }

    /// Accept a pending authority transfer. Must be signed by the proposed new authority.
    pub fn accept_authority_transfer(ctx: Context<AcceptAuthorityTransfer>) -> Result<()> {
        instructions::accept_authority::handler(ctx)
    }

    /// Cancel a pending authority transfer. Master authority only.
    pub fn cancel_authority_transfer(ctx: Context<CancelAuthorityTransfer>) -> Result<()> {
        instructions::cancel_authority::handler(ctx)
    }

    // --- SSS-2 Compliance Instructions ---

    /// Add an address to the blacklist. Requires Blacklister role.
    /// Only available on SSS-2 configs (transfer hook enabled).
    pub fn add_to_blacklist(
        ctx: Context<AddToBlacklist>,
        address: Pubkey,
        reason: String,
    ) -> Result<()> {
        instructions::add_to_blacklist::handler(ctx, address, reason)
    }

    /// Remove an address from the blacklist. Requires Blacklister role.
    /// Closes the BlacklistEntry PDA and returns rent.
    pub fn remove_from_blacklist(ctx: Context<RemoveFromBlacklist>, address: Pubkey) -> Result<()> {
        instructions::remove_from_blacklist::handler(ctx, address)
    }

    /// Seize tokens from an account using the permanent delegate.
    /// Requires Seizer role and permanent delegate enabled.
    pub fn seize<'info>(
        ctx: Context<'_, '_, 'info, 'info, Seize<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::seize::handler(ctx, amount)
    }

    // --- View / Read-only Instructions ---

    /// Return supply statistics: total_minted, total_burned, current_supply, supply_cap.
    pub fn get_supply_info(ctx: Context<GetSupplyInfo>) -> Result<SupplyInfo> {
        instructions::view::get_supply_info(ctx)
    }

    /// Return quota statistics for a specific minter: quota, minted, remaining.
    pub fn get_minter_info(ctx: Context<GetMinterInfo>, minter: Pubkey) -> Result<MinterInfo> {
        instructions::view::get_minter_info(ctx, minter)
    }

    /// Simulate whether a mint of `amount` would succeed, without modifying state.
    pub fn preview_mint(
        ctx: Context<PreviewMint>,
        minter: Pubkey,
        amount: u64,
    ) -> Result<PreviewMintResult> {
        instructions::view::preview_mint(ctx, minter, amount)
    }

    /// Return whether an address is on the blacklist.
    pub fn is_blacklisted(ctx: Context<IsBlacklisted>, address: Pubkey) -> Result<bool> {
        instructions::view::is_blacklisted(ctx, address)
    }

    /// Return the full stablecoin configuration.
    pub fn get_config(ctx: Context<GetConfig>) -> Result<ConfigInfo> {
        instructions::view::get_config(ctx)
    }
}
