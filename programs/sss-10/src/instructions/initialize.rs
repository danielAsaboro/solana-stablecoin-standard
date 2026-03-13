use anchor_lang::prelude::*;

use crate::error::AsyncError;
use crate::events::AsyncConfigInitialized;
use crate::state::AsyncConfig;

/// Accounts required to initialize the async mint/redeem config.
///
/// The signer becomes the authority who can approve and reject requests.
/// `stablecoin_config` is validated to be a non-default key; full cross-program
/// account ownership verification is left to the caller (the config is a foreign
/// PDA from the SSS program).
#[derive(Accounts)]
pub struct InitializeAsyncConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = AsyncConfig::LEN,
        seeds = [AsyncConfig::SEED_PREFIX, stablecoin_config.key().as_ref()],
        bump,
    )]
    pub async_config: Account<'info, AsyncConfig>,

    /// CHECK: Foreign SSS StablecoinConfig PDA — validated as non-default only.
    pub stablecoin_config: AccountInfo<'info>,

    /// CHECK: Token-2022 mint referenced by the stablecoin config.
    pub mint: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Initialize a new [`AsyncConfig`] for the given stablecoin config.
///
/// Validates that `stablecoin_config` is not the default pubkey (sanity check),
/// then sets all fields and emits [`AsyncConfigInitialized`].
pub fn handler(ctx: Context<InitializeAsyncConfig>) -> Result<()> {
    require_keys_neq!(
        ctx.accounts.stablecoin_config.key(),
        Pubkey::default(),
        AsyncError::Unauthorized
    );

    let async_config = &mut ctx.accounts.async_config;
    async_config.stablecoin_config = ctx.accounts.stablecoin_config.key();
    async_config.authority = ctx.accounts.authority.key();
    async_config.mint = ctx.accounts.mint.key();
    async_config.total_requests = 0;
    async_config.bump = ctx.bumps.async_config;

    emit!(AsyncConfigInitialized {
        async_config: async_config.key(),
        stablecoin_config: async_config.stablecoin_config,
        authority: async_config.authority,
        mint: async_config.mint,
    });

    Ok(())
}
