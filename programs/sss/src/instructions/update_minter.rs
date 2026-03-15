use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::MinterQuotaUpdated;
use crate::state::{MinterQuota, StablecoinConfig};

/// Accounts required to set or update a minter's quota.
///
/// Only the master authority can call this instruction. The minter quota PDA
/// is created on first assignment (`init_if_needed`). Updating the quota does
/// not reset the `minted` counter, preserving the audit trail.
#[derive(Accounts)]
#[instruction(minter: Pubkey)]
pub struct UpdateMinter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,

    // Safety: init_if_needed is acceptable here because only the master authority
    // (validated by the config constraint above) can call this instruction. A
    // reinitialization attack requires an untrusted caller, which is impossible.
    #[account(
        init_if_needed,
        payer = authority,
        space = MinterQuota::LEN,
        seeds = [MINTER_QUOTA_SEED, config.key().as_ref(), minter.as_ref()],
        bump,
    )]
    pub minter_quota: Account<'info, MinterQuota>,

    pub system_program: Program<'info, System>,
}

/// Set or update a minter's maximum mint quota.
///
/// The `minted` counter is intentionally preserved so that increasing the quota
/// after partial minting does not erase history. Emits [`MinterQuotaUpdated`].
pub fn handler(ctx: Context<UpdateMinter>, minter: Pubkey, quota: u64) -> Result<()> {
    let minter_quota = &mut ctx.accounts.minter_quota;
    minter_quota.config = ctx.accounts.config.key();
    minter_quota.minter = minter;
    minter_quota.quota = quota;
    // Don't reset minted — preserve history
    minter_quota.bump = ctx.bumps.minter_quota;

    emit!(MinterQuotaUpdated {
        config: ctx.accounts.config.key(),
        minter,
        new_quota: quota,
        updated_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
