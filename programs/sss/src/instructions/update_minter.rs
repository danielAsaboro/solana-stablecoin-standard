use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::MinterQuotaUpdated;
use crate::state::{MinterQuota, StablecoinConfig};

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
