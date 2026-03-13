use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::MinterQuotaReset;
use crate::state::{MinterQuota, StablecoinConfig};

/// Accounts required to reset a minter's cumulative `minted` counter.
///
/// Only the master authority may call this. Resetting allows a minter to mint
/// up to their full quota again without changing the quota itself. Useful for
/// period-based minting cycles (e.g., monthly issuance limits).
#[derive(Accounts)]
#[instruction(minter: Pubkey)]
pub struct ResetMinterQuota<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [MINTER_QUOTA_SEED, config.key().as_ref(), minter.as_ref()],
        bump = minter_quota.bump,
    )]
    pub minter_quota: Account<'info, MinterQuota>,
}

/// Reset a minter's cumulative `minted` counter to zero.
///
/// The minter's `quota` is unchanged — only the running total is cleared,
/// allowing the minter to issue up to their full quota again. Emits
/// [`MinterQuotaReset`].
pub fn handler(ctx: Context<ResetMinterQuota>, _minter: Pubkey) -> Result<()> {
    let minter_quota = &mut ctx.accounts.minter_quota;
    let previous_minted = minter_quota.minted;
    minter_quota.minted = 0;

    emit!(MinterQuotaReset {
        config: ctx.accounts.config.key(),
        minter: minter_quota.minter,
        previous_minted,
        reset_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
