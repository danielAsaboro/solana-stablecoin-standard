//! Initialize a new [`CapsConfig`] PDA for a stablecoin.

use anchor_lang::prelude::*;

use crate::events::CapsConfigInitialized;
use crate::state::CapsConfig;

/// Accounts required to initialize the caps configuration.
///
/// The `authority` signer becomes the caps authority and is responsible for
/// future updates. The `stablecoin_config` is an unchecked external account —
/// this program does not own or validate its structure, only uses its key as a
/// PDA seed so caps are uniquely tied to one stablecoin.
#[derive(Accounts)]
pub struct InitializeCapsConfig<'info> {
    /// The signer who pays for account creation and becomes the caps authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The SSS stablecoin config key used as a PDA seed.
    ///
    /// CHECK: This is an external account whose pubkey we use only as a seed.
    /// We do not read or write its data.
    pub stablecoin_config: AccountInfo<'info>,

    /// The caps configuration PDA to be created.
    #[account(
        init,
        payer = authority,
        space = CapsConfig::LEN,
        seeds = [CapsConfig::SEED_PREFIX, stablecoin_config.key().as_ref()],
        bump,
    )]
    pub caps_config: Account<'info, CapsConfig>,

    pub system_program: Program<'info, System>,
}

/// Create a new [`CapsConfig`] PDA and set the initial supply caps.
///
/// Sets the `authority` to the transaction signer. Both caps default to `0`
/// (unlimited) if the caller passes `0`. Emits [`CapsConfigInitialized`].
pub fn handler(
    ctx: Context<InitializeCapsConfig>,
    global_cap: u64,
    per_minter_cap: u64,
) -> Result<()> {
    let caps_config = &mut ctx.accounts.caps_config;
    caps_config.stablecoin_config = ctx.accounts.stablecoin_config.key();
    caps_config.authority = ctx.accounts.authority.key();
    caps_config.global_cap = global_cap;
    caps_config.per_minter_cap = per_minter_cap;
    caps_config.bump = ctx.bumps.caps_config;

    emit!(CapsConfigInitialized {
        stablecoin_config: ctx.accounts.stablecoin_config.key(),
        authority: ctx.accounts.authority.key(),
        global_cap,
        per_minter_cap,
    });

    Ok(())
}
