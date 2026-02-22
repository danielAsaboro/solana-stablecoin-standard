use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::OracleError;
use crate::events::OracleInitialized;
use crate::state::OracleConfig;

/// Parameters for initializing a new oracle configuration.
///
/// Passed to [`initialize_oracle`](crate::sss_oracle::initialize_oracle).
#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeOracleParams {
    /// Base currency identifier (e.g., "USD", "BRL", "EUR", "CPI").
    /// Max 8 bytes.
    pub base_currency: String,
    /// Maximum acceptable age (in seconds) of the aggregator price data.
    /// Must be greater than zero.
    pub staleness_threshold: i64,
    /// Number of decimal places for price values (0–18).
    pub price_decimals: u8,
    /// Minimum acceptable price (scaled by `10^price_decimals`).
    pub min_price: u64,
    /// Maximum acceptable price (scaled by `10^price_decimals`).
    pub max_price: u64,
    /// Whether manual price pushing is enabled.
    pub manual_override: bool,
}

/// Accounts required to initialize a new oracle configuration.
///
/// Creates an [`OracleConfig`] PDA linked to an existing SSS stablecoin config
/// and a Switchboard V2 aggregator. The authority (payer) becomes the oracle
/// config authority who can update settings and push manual prices.
#[derive(Accounts)]
pub struct InitializeOracle<'info> {
    /// The authority who will own this oracle config. Must be a signer and payer.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The oracle config PDA to initialize.
    #[account(
        init,
        payer = authority,
        space = OracleConfig::LEN,
        seeds = [ORACLE_CONFIG_SEED, stablecoin_config.key().as_ref()],
        bump,
    )]
    pub oracle_config: Account<'info, OracleConfig>,

    /// The SSS stablecoin config PDA that this oracle is linked to.
    /// Passed as an unchecked account since it lives in a different program.
    /// CHECK: We store this pubkey as a reference — the oracle does not CPI
    /// into the SSS program. Validity is the caller's responsibility.
    pub stablecoin_config: UncheckedAccount<'info>,

    /// The Switchboard V2 aggregator account that provides the price feed.
    /// CHECK: The aggregator account is validated during `refresh_price` when
    /// we actually read its data. At initialization, we only store the address.
    pub aggregator: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Initialize a new oracle configuration for a stablecoin.
///
/// Creates the [`OracleConfig`] PDA and links it to the specified SSS stablecoin
/// config and Switchboard aggregator. The price starts at zero and must be
/// populated via [`refresh_price`] or [`push_manual_price`] before use.
///
/// # Validation
///
/// - `base_currency` must not exceed [`MAX_CURRENCY_LEN`] (8 bytes).
/// - `staleness_threshold` must be greater than zero.
/// - `min_price` must be less than `max_price`.
///
/// # Events
///
/// Emits [`OracleInitialized`].
pub fn handler(ctx: Context<InitializeOracle>, params: InitializeOracleParams) -> Result<()> {
    require!(
        params.base_currency.len() <= MAX_CURRENCY_LEN,
        OracleError::CurrencyTooLong
    );
    require!(
        params.staleness_threshold > 0,
        OracleError::InvalidStaleness
    );
    require!(
        params.min_price < params.max_price,
        OracleError::InvalidPriceBounds
    );

    let oracle_config = &mut ctx.accounts.oracle_config;
    oracle_config.authority = ctx.accounts.authority.key();
    oracle_config.stablecoin_config = ctx.accounts.stablecoin_config.key();
    oracle_config.aggregator = ctx.accounts.aggregator.key();
    oracle_config.base_currency = params.base_currency.clone();
    oracle_config.staleness_threshold = params.staleness_threshold;
    oracle_config.price_decimals = params.price_decimals;
    oracle_config.min_price = params.min_price;
    oracle_config.max_price = params.max_price;
    oracle_config.manual_override = params.manual_override;
    oracle_config.last_price = 0;
    oracle_config.last_timestamp = 0;
    oracle_config.bump = ctx.bumps.oracle_config;
    oracle_config._reserved = [0u8; 64];

    emit!(OracleInitialized {
        oracle_config: ctx.accounts.oracle_config.key(),
        stablecoin_config: ctx.accounts.stablecoin_config.key(),
        aggregator: ctx.accounts.aggregator.key(),
        base_currency: params.base_currency,
        authority: ctx.accounts.authority.key(),
    });

    Ok(())
}
