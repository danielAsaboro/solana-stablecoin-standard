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

    /// Assign or revoke a role. Master authority only.
    pub fn update_roles(
        ctx: Context<UpdateRoles>,
        role_type: u8,
        user: Pubkey,
        active: bool,
    ) -> Result<()> {
        instructions::update_roles::handler(ctx, role_type, user, active)
    }

    /// Set or update a minter's quota. Master authority only.
    pub fn update_minter(ctx: Context<UpdateMinter>, minter: Pubkey, quota: u64) -> Result<()> {
        instructions::update_minter::handler(ctx, minter, quota)
    }

    /// Transfer master authority to a new address.
    pub fn transfer_authority(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
        instructions::transfer_authority::handler(ctx, new_authority)
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
    pub fn remove_from_blacklist(
        ctx: Context<RemoveFromBlacklist>,
        address: Pubkey,
    ) -> Result<()> {
        instructions::remove_from_blacklist::handler(ctx, address)
    }

    /// Seize tokens from an account using the permanent delegate.
    /// Requires Seizer role and permanent delegate enabled.
    pub fn seize<'info>(ctx: Context<'_, '_, 'info, 'info, Seize<'info>>, amount: u64) -> Result<()> {
        instructions::seize::handler(ctx, amount)
    }
}
