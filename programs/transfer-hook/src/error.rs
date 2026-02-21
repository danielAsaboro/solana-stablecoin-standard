use anchor_lang::prelude::*;

#[error_code]
pub enum TransferHookError {
    #[msg("Source address is blacklisted")]
    SourceBlacklisted,

    #[msg("Destination address is blacklisted")]
    DestinationBlacklisted,

    #[msg("Invalid extra account metas")]
    InvalidExtraAccountMetas,
}
