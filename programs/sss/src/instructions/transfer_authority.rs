use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::AuthorityTransferred;
use crate::state::StablecoinConfig;

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.master_authority == authority.key() @ StablecoinError::InvalidAuthority,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

pub fn handler(ctx: Context<TransferAuthority>, new_authority: Pubkey) -> Result<()> {
    require!(
        new_authority != ctx.accounts.config.master_authority,
        StablecoinError::SameAuthority
    );

    let previous = ctx.accounts.config.master_authority;
    ctx.accounts.config.master_authority = new_authority;

    emit!(AuthorityTransferred {
        config: ctx.accounts.config.key(),
        previous_authority: previous,
        new_authority,
    });

    Ok(())
}
