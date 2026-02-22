//! Custom error codes for the SSS Privacy Module.
//!
//! Each variant maps to a unique Anchor error code and includes a human-readable
//! message returned to clients.

use anchor_lang::prelude::*;

/// Errors that can be returned by privacy program instructions.
#[error_code]
pub enum PrivacyError {
    /// The caller is not the privacy config authority.
    #[msg("Unauthorized - caller is not the privacy authority")]
    Unauthorized,

    /// Attempted to initialize a privacy config that already exists.
    #[msg("Privacy config already initialized for this stablecoin")]
    AlreadyInitialized,

    /// Attempted to remove an address that is not on the allowlist.
    #[msg("Address is not on the allowlist")]
    AddressNotOnAllowlist,

    /// The provided label exceeds the maximum allowed length.
    #[msg("Label exceeds maximum length of 32 bytes")]
    LabelTooLong,

    /// The linked stablecoin config does not have confidential transfers enabled.
    #[msg("Confidential transfers are not enabled on the stablecoin config")]
    ConfidentialTransfersNotEnabled,

    /// Arithmetic overflow during a checked operation.
    #[msg("Arithmetic overflow")]
    MathOverflow,
}
