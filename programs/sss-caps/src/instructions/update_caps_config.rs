//! Update the supply caps on an existing [`CapsConfig`] PDA.

use anchor_lang::prelude::*;

use crate::error::CapsError;
use crate::events::CapsConfigUpdated;
use crate::state::CapsConfig;

/// Accounts required to update the caps configuration.
#[derive(Accounts)]
pub struct UpdateCapsConfig<'info> {
    /// The caps authority — must match `caps_config.authority`.
    pub authority: Signer<'info>,

    /// The caps configuration PDA to update.
    #[account(
        mut,
        seeds = [CapsConfig::SEED_PREFIX, caps_config.stablecoin_config.as_ref()],
        bump = caps_config.bump,
        constraint = caps_config.authority == authority.key() @ CapsError::Unauthorized,
    )]
    pub caps_config: Account<'info, CapsConfig>,
}

/// Update both supply caps on an existing [`CapsConfig`].
///
/// Requires the transaction to be signed by the caps `authority`. Rejects the
/// update if neither cap value changes. Emits [`CapsConfigUpdated`].
pub fn handler(
    ctx: Context<UpdateCapsConfig>,
    global_cap: u64,
    per_minter_cap: u64,
) -> Result<()> {
    let caps_config = &mut ctx.accounts.caps_config;

    require!(
        caps_config.global_cap != global_cap || caps_config.per_minter_cap != per_minter_cap,
        CapsError::SameCaps
    );

    let old_global_cap = caps_config.global_cap;
    let old_per_minter_cap = caps_config.per_minter_cap;

    caps_config.global_cap = global_cap;
    caps_config.per_minter_cap = per_minter_cap;

    emit!(CapsConfigUpdated {
        stablecoin_config: caps_config.stablecoin_config,
        old_global_cap,
        new_global_cap: global_cap,
        old_per_minter_cap,
        new_per_minter_cap: per_minter_cap,
        updated_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
