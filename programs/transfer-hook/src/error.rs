//! Custom error codes for the transfer hook program.

use anchor_lang::prelude::*;

/// Errors returned when a transfer is blocked by blacklist enforcement.
#[error_code]
pub enum TransferHookError {
    #[msg("Source address is blacklisted")]
    SourceBlacklisted,

    #[msg("Destination address is blacklisted")]
    DestinationBlacklisted,

    #[msg("Invalid extra account metas")]
    InvalidExtraAccountMetas,

    #[msg("Stablecoin is paused — transfers are blocked")]
    Paused,
}
