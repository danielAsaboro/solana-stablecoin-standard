use anchor_lang::prelude::*;
use anchor_spl::token_interface;
use anchor_spl::token_interface::{TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::StablecoinError;
use crate::events::TokensMinted;
use crate::state::{MinterQuota, RoleAccount, StablecoinConfig};

/// Accounts required to mint tokens to a recipient.
///
/// The minter must hold an active Minter role and have remaining quota. The
/// config PDA signs the `mint_to` CPI as the mint authority.
#[derive(Accounts)]
pub struct MintTokens<'info> {
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), &[ROLE_MINTER], minter.key().as_ref()],
        bump = role_account.bump,
        constraint = role_account.active @ StablecoinError::Unauthorized,
    )]
    pub role_account: Account<'info, RoleAccount>,

    #[account(
        mut,
        seeds = [MINTER_QUOTA_SEED, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_quota.bump,
    )]
    pub minter_quota: Account<'info, MinterQuota>,

    /// CHECK: Token-2022 mint, validated by config.mint constraint
    #[account(
        mut,
        address = config.mint,
    )]
    pub mint: AccountInfo<'info>,

    /// Recipient's token account, validated to belong to the correct mint and token program.
    #[account(
        mut,
        token::mint = mint,
        token::token_program = token_program,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Mint `amount` tokens to the recipient's token account.
///
/// Validates the stablecoin is not paused, the minter has sufficient quota,
/// checks the global supply cap (if non-zero), then performs a `mint_to` CPI
/// signed by the config PDA. If `default_account_frozen` is set and the
/// recipient account is not yet frozen, a `freeze_account` CPI is issued
/// immediately after minting. Updates the minter's cumulative total and the
/// global `total_minted` counter. Emits [`TokensMinted`].
pub fn handler(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);
    require!(!ctx.accounts.config.paused, StablecoinError::Paused);

    let minter_quota = &mut ctx.accounts.minter_quota;
    let new_minted = minter_quota
        .minted
        .checked_add(amount)
        .ok_or(StablecoinError::MathOverflow)?;
    require!(
        new_minted <= minter_quota.quota,
        StablecoinError::QuotaExceeded
    );
    minter_quota.minted = new_minted;

    let config = &mut ctx.accounts.config;

    // FIX-2: enforce global supply cap (0 = unlimited)
    if config.supply_cap > 0 {
        let new_total = config
            .total_minted
            .checked_add(amount)
            .ok_or(StablecoinError::MathOverflow)?;
        require!(
            new_total <= config.supply_cap,
            StablecoinError::SupplyCapExceeded
        );
    }

    config.total_minted = config
        .total_minted
        .checked_add(amount)
        .ok_or(StablecoinError::MathOverflow)?;

    let mint_key = config.mint;
    let bump = config.bump;
    let default_frozen = config.default_account_frozen;
    let signer_seeds: &[&[&[u8]]] = &[&[STABLECOIN_SEED, mint_key.as_ref(), &[bump]]];

    // CPI: mint_to via config PDA as mint authority
    token_interface::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // FIX-1: if default_account_frozen, freeze the recipient's ATA after minting
    // (skip if already frozen to avoid a redundant CPI error)
    if default_frozen && !ctx.accounts.recipient_token_account.is_frozen() {
        token_interface::freeze_account(CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            token_interface::FreezeAccount {
                account: ctx.accounts.recipient_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ))?;
    }

    emit!(TokensMinted {
        config: ctx.accounts.config.key(),
        minter: ctx.accounts.minter.key(),
        recipient: ctx.accounts.recipient_token_account.key(),
        amount,
        minter_total_minted: new_minted,
    });

    Ok(())
}
