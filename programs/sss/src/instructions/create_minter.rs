use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::MinterQuotaUpdated;
use crate::state::{MinterQuota, StablecoinConfig};

/// Accounts required to create a new minter quota.
///
/// Only the master authority can call this instruction. The minter quota PDA
/// is created with `init`, preventing reinitialization of existing minters.
/// To update an existing minter's quota, use [`update_minter`](crate::sss::update_minter).
#[derive(Accounts)]
#[instruction(minter: Pubkey)]
pub struct CreateMinter<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init,
        payer = authority,
        space = MinterQuota::LEN,
        seeds = [MINTER_QUOTA_SEED, config.key().as_ref(), minter.as_ref()],
        bump,
    )]
    pub minter_quota: Account<'info, MinterQuota>,

    pub system_program: Program<'info, System>,
}

/// Create a new minter with the given quota.
///
/// Fails if the minter already exists. Emits [`MinterQuotaUpdated`].
pub fn handler(ctx: Context<CreateMinter>, minter: Pubkey, quota: u64) -> Result<()> {
    let minter_quota = &mut ctx.accounts.minter_quota;
    minter_quota.config = ctx.accounts.config.key();
    minter_quota.minter = minter;
    minter_quota.quota = quota;
    minter_quota.minted = 0;
    minter_quota.bump = ctx.bumps.minter_quota;

    emit!(MinterQuotaUpdated {
        config: ctx.accounts.config.key(),
        minter,
        new_quota: quota,
        updated_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
