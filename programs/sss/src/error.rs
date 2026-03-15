//! Custom error codes for the SSS program.
//!
//! Each variant maps to a unique Anchor error code and includes a human-readable
//! message returned to clients.

use anchor_lang::prelude::*;

/// Errors that can be returned by SSS program instructions.
#[error_code]
pub enum StablecoinError {
    #[msg("Unauthorized - caller lacks the required role")]
    Unauthorized,

    #[msg("Stablecoin is paused")]
    Paused,

    #[msg("Stablecoin is not paused")]
    NotPaused,

    #[msg("Minter quota exceeded")]
    QuotaExceeded,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Name exceeds maximum length")]
    NameTooLong,

    #[msg("Symbol exceeds maximum length")]
    SymbolTooLong,

    #[msg("URI exceeds maximum length")]
    UriTooLong,

    #[msg("Reason exceeds maximum length")]
    ReasonTooLong,

    #[msg("Invalid role type")]
    InvalidRole,

    #[msg("Compliance features not enabled on this stablecoin (SSS-1 config)")]
    ComplianceNotEnabled,

    #[msg("Permanent delegate not enabled on this stablecoin")]
    PermanentDelegateNotEnabled,

    #[msg("Address is already blacklisted")]
    AlreadyBlacklisted,

    #[msg("Address is not blacklisted")]
    NotBlacklisted,

    #[msg("Arithmetic overflow")]
    MathOverflow,

    #[msg("Invalid authority - not the master authority")]
    InvalidAuthority,

    #[msg("Cannot transfer authority to the same address")]
    SameAuthority,

    #[msg("Invalid decimals - must be between 0 and 9")]
    InvalidDecimals,

    #[msg("Invalid configuration: transfer hook requires a valid program ID")]
    InvalidConfig,

    #[msg("Global supply cap would be exceeded by this mint")]
    SupplyCapExceeded,

    #[msg("An authority transfer is already in progress — cancel or accept first")]
    PendingTransferExists,

    #[msg("No authority transfer is in progress")]
    NoPendingTransfer,

    #[msg("Only the proposed pending authority may accept the transfer")]
    InvalidPendingAuthority,

    #[msg("Evidence URI exceeds maximum length")]
    EvidenceUriTooLong,

    #[msg("Evidence hash must be non-zero when attaching evidence")]
    InvalidEvidenceHash,
}
