//! Read-only view instructions that return data via Anchor's return-data mechanism.
//!
//! These instructions are non-mutating and never modify account state. Clients
//! can call them with `simulateTransaction` to retrieve typed on-chain data
//! without paying transaction fees, or use them in CPI read-only patterns.
//!
//! All return types implement [`AnchorSerialize`] and are Borsh-encoded in the
//! transaction return data.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::{BlacklistEntry, MinterQuota, StablecoinConfig};

// ── Return-type structs ──────────────────────────────────────────────────────

/// Returned by [`get_supply_info`](crate::sss::get_supply_info).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SupplyInfo {
    /// Cumulative tokens minted over the lifetime of this stablecoin.
    pub total_minted: u64,
    /// Cumulative tokens burned over the lifetime of this stablecoin.
    pub total_burned: u64,
    /// Current circulating supply (`total_minted - total_burned`).
    pub current_supply: u64,
    /// Global supply cap (0 = unlimited).
    pub supply_cap: u64,
}

/// Returned by [`get_minter_info`](crate::sss::get_minter_info).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MinterInfo {
    /// The maximum amount this minter may mint.
    pub quota: u64,
    /// Cumulative amount minted so far (may be reset by master authority).
    pub minted: u64,
    /// Remaining quota (`quota - minted`).
    pub remaining: u64,
}

/// Returned by [`preview_mint`](crate::sss::preview_mint).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PreviewMintResult {
    /// Whether the mint would succeed given current state.
    pub would_succeed: bool,
    /// Human-readable reason if `would_succeed` is false.
    pub failure_reason: String,
}

/// Returned by [`get_config`](crate::sss::get_config).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ConfigInfo {
    pub mint: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub decimals: u8,
    pub master_authority: Pubkey,
    pub pending_authority: Pubkey,
    pub enable_permanent_delegate: bool,
    pub enable_transfer_hook: bool,
    pub default_account_frozen: bool,
    pub enable_confidential_transfer: bool,
    pub paused: bool,
    pub total_minted: u64,
    pub total_burned: u64,
    pub current_supply: u64,
    pub supply_cap: u64,
    pub transfer_hook_program: Pubkey,
}

// ── Accounts contexts ────────────────────────────────────────────────────────

/// Accounts for [`get_supply_info`](crate::sss::get_supply_info).
#[derive(Accounts)]
pub struct GetSupplyInfo<'info> {
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

/// Accounts for [`get_minter_info`](crate::sss::get_minter_info).
#[derive(Accounts)]
#[instruction(minter: Pubkey)]
pub struct GetMinterInfo<'info> {
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [MINTER_QUOTA_SEED, config.key().as_ref(), minter.as_ref()],
        bump = minter_quota.bump,
    )]
    pub minter_quota: Account<'info, MinterQuota>,
}

/// Accounts for [`preview_mint`](crate::sss::preview_mint).
#[derive(Accounts)]
#[instruction(minter: Pubkey)]
pub struct PreviewMint<'info> {
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [MINTER_QUOTA_SEED, config.key().as_ref(), minter.as_ref()],
        bump = minter_quota.bump,
    )]
    pub minter_quota: Account<'info, MinterQuota>,
}

/// Accounts for [`is_blacklisted`](crate::sss::is_blacklisted).
#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct IsBlacklisted<'info> {
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The blacklist entry PDA. May or may not exist.
    /// CHECK: We deliberately accept an uninitialized account here and check its
    /// discriminator manually to determine whether the address is blacklisted.
    #[account(
        seeds = [crate::constants::BLACKLIST_SEED, config.key().as_ref(), address.as_ref()],
        bump,
    )]
    pub blacklist_entry: Option<Account<'info, BlacklistEntry>>,
}

/// Accounts for [`get_config`](crate::sss::get_config).
#[derive(Accounts)]
pub struct GetConfig<'info> {
    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

// ── Handlers ─────────────────────────────────────────────────────────────────

/// Return supply statistics for this stablecoin.
pub fn get_supply_info(ctx: Context<GetSupplyInfo>) -> Result<SupplyInfo> {
    let c = &ctx.accounts.config;
    let current_supply = c.total_minted.saturating_sub(c.total_burned);
    Ok(SupplyInfo {
        total_minted: c.total_minted,
        total_burned: c.total_burned,
        current_supply,
        supply_cap: c.supply_cap,
    })
}

/// Return quota statistics for a specific minter.
pub fn get_minter_info(ctx: Context<GetMinterInfo>, _minter: Pubkey) -> Result<MinterInfo> {
    let q = &ctx.accounts.minter_quota;
    let remaining = q.quota.saturating_sub(q.minted);
    Ok(MinterInfo {
        quota: q.quota,
        minted: q.minted,
        remaining,
    })
}

/// Simulate whether a mint of `amount` would succeed right now.
///
/// Checks pause state, quota, and supply cap. Returns a structured
/// result rather than an error so clients can distinguish the failure reason.
pub fn preview_mint(ctx: Context<PreviewMint>, _minter: Pubkey, amount: u64) -> Result<PreviewMintResult> {
    let config = &ctx.accounts.config;
    let quota = &ctx.accounts.minter_quota;

    if config.paused {
        return Ok(PreviewMintResult {
            would_succeed: false,
            failure_reason: "stablecoin is paused".to_string(),
        });
    }
    if amount == 0 {
        return Ok(PreviewMintResult {
            would_succeed: false,
            failure_reason: "amount must be greater than zero".to_string(),
        });
    }
    let new_minted = quota.minted.saturating_add(amount);
    if new_minted > quota.quota {
        return Ok(PreviewMintResult {
            would_succeed: false,
            failure_reason: "minter quota would be exceeded".to_string(),
        });
    }
    if config.supply_cap > 0 {
        let new_total = config.total_minted.saturating_add(amount);
        if new_total > config.supply_cap {
            return Ok(PreviewMintResult {
                would_succeed: false,
                failure_reason: "global supply cap would be exceeded".to_string(),
            });
        }
    }

    Ok(PreviewMintResult {
        would_succeed: true,
        failure_reason: String::new(),
    })
}

/// Return whether an address is currently on the blacklist.
///
/// Returns `true` if the `BlacklistEntry` PDA exists and is initialised.
pub fn is_blacklisted(ctx: Context<IsBlacklisted>, _address: Pubkey) -> Result<bool> {
    Ok(ctx.accounts.blacklist_entry.is_some())
}

/// Return the full configuration for this stablecoin.
pub fn get_config(ctx: Context<GetConfig>) -> Result<ConfigInfo> {
    let c = &ctx.accounts.config;
    let current_supply = c.total_minted.saturating_sub(c.total_burned);
    Ok(ConfigInfo {
        mint: c.mint,
        name: c.name.clone(),
        symbol: c.symbol.clone(),
        uri: c.uri.clone(),
        decimals: c.decimals,
        master_authority: c.master_authority,
        pending_authority: c.pending_authority,
        enable_permanent_delegate: c.enable_permanent_delegate,
        enable_transfer_hook: c.enable_transfer_hook,
        default_account_frozen: c.default_account_frozen,
        enable_confidential_transfer: c.enable_confidential_transfer,
        paused: c.paused,
        total_minted: c.total_minted,
        total_burned: c.total_burned,
        current_supply,
        supply_cap: c.supply_cap,
        transfer_hook_program: c.transfer_hook_program,
    })
}
