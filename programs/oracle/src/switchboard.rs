//! Switchboard V2 aggregator data parsing.
//!
//! Reads price data directly from Switchboard V2 aggregator account bytes
//! at known Borsh serialization offsets. This approach avoids pulling in the
//! full `switchboard-solana` SDK as a dependency, keeping the program lean
//! and free of transitive dependency conflicts.
//!
//! ## Data Layout Reference
//!
//! Switchboard V2 uses Anchor and Borsh serialization. The
//! `AggregatorAccountData` struct is preceded by an 8-byte Anchor discriminator.
//! We parse only the fields from `latest_confirmed_round` that we need:
//!
//! - `round_open_timestamp` (i64): when the latest round was opened
//! - `result.mantissa` (i128): the price mantissa
//! - `result.scale` (u32): decimal scale factor (value = mantissa × 10^(−scale))
//!
//! See [`constants`](crate::constants) for the exact byte offsets.

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::OracleError;

/// Parsed result from a Switchboard V2 aggregator's latest confirmed round.
#[derive(Debug, Clone, Copy)]
pub struct AggregatorResult {
    /// Unix timestamp when the round was opened.
    pub timestamp: i64,
    /// Price mantissa (signed, from `SwitchboardDecimal`).
    pub mantissa: i128,
    /// Decimal scale factor (value = mantissa × 10^(−scale)).
    pub scale: u32,
}

/// Parse the latest confirmed result from a Switchboard V2 aggregator account.
///
/// Reads `round_open_timestamp`, `result.mantissa`, and `result.scale` from
/// the `latest_confirmed_round` field at known byte offsets in the Borsh-serialized
/// account data.
///
/// # Errors
///
/// Returns [`OracleError::InvalidAggregatorData`] if the account data is too
/// short to contain the required fields (minimum 393 bytes).
pub fn parse_aggregator_result(data: &[u8]) -> Result<AggregatorResult> {
    require!(
        data.len() >= AGGREGATOR_MIN_DATA_LEN,
        OracleError::InvalidAggregatorData
    );

    // Parse round_open_timestamp (i64, 8 bytes at offset 365)
    let timestamp_bytes: [u8; 8] = data
        [AGGREGATOR_TIMESTAMP_OFFSET..AGGREGATOR_TIMESTAMP_OFFSET + 8]
        .try_into()
        .map_err(|_| error!(OracleError::InvalidAggregatorData))?;
    let timestamp = i64::from_le_bytes(timestamp_bytes);

    // Parse result.mantissa (i128, 16 bytes at offset 373)
    let mantissa_bytes: [u8; 16] = data
        [AGGREGATOR_MANTISSA_OFFSET..AGGREGATOR_MANTISSA_OFFSET + 16]
        .try_into()
        .map_err(|_| error!(OracleError::InvalidAggregatorData))?;
    let mantissa = i128::from_le_bytes(mantissa_bytes);

    // Parse result.scale (u32, 4 bytes at offset 389)
    let scale_bytes: [u8; 4] = data[AGGREGATOR_SCALE_OFFSET..AGGREGATOR_SCALE_OFFSET + 4]
        .try_into()
        .map_err(|_| error!(OracleError::InvalidAggregatorData))?;
    let scale = u32::from_le_bytes(scale_bytes);

    Ok(AggregatorResult {
        timestamp,
        mantissa,
        scale,
    })
}

/// Convert a Switchboard `SwitchboardDecimal` (mantissa + scale) to a u64
/// fixed-point value with the specified number of decimal places.
///
/// The Switchboard value is: `mantissa × 10^(−scale)`.
/// We convert to: `value × 10^target_decimals`.
///
/// # Example
///
/// For EUR/USD price of 1.085 with mantissa = 1085000, scale = 6:
/// - With target_decimals = 6: returns 1_085_000
/// - With target_decimals = 8: returns 108_500_000
///
/// # Errors
///
/// Returns [`OracleError::InvalidPrice`] if the mantissa is negative or zero.
/// Returns [`OracleError::MathOverflow`] if the conversion overflows u64.
pub fn convert_to_fixed_point(mantissa: i128, scale: u32, target_decimals: u8) -> Result<u64> {
    require!(mantissa > 0, OracleError::InvalidPrice);

    let mantissa_u128 = mantissa as u128;
    let target_exp = target_decimals as u32;

    let result = if target_exp >= scale {
        // Need to multiply: shift mantissa left by (target_exp - scale) digits
        let shift = target_exp
            .checked_sub(scale)
            .ok_or(OracleError::MathOverflow)?;
        let multiplier = 10u128.checked_pow(shift).ok_or(OracleError::MathOverflow)?;
        mantissa_u128
            .checked_mul(multiplier)
            .ok_or(OracleError::MathOverflow)?
    } else {
        // Need to divide: shift mantissa right by (scale - target_exp) digits
        let shift = scale
            .checked_sub(target_exp)
            .ok_or(OracleError::MathOverflow)?;
        let divisor = 10u128.checked_pow(shift).ok_or(OracleError::MathOverflow)?;
        mantissa_u128
            .checked_div(divisor)
            .ok_or(OracleError::MathOverflow)?
    };

    // Convert u128 → u64 safely
    u64::try_from(result).map_err(|_| error!(OracleError::MathOverflow))
}
