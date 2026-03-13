//! Custom error codes for the SSS Allowlist module.
//!
//! Each variant maps to a unique Anchor error code and includes a human-readable
//! message returned to clients.

use anchor_lang::prelude::*;

/// Errors that can be returned by SSS Allowlist program instructions.
#[error_code]
pub enum AllowlistError {
    #[msg("Unauthorized - caller is not the allowlist authority")]
    Unauthorized,

    #[msg("Address is already listed in the allowlist")]
    AlreadyListed,

    #[msg("Address is not present in the allowlist")]
    NotListed,

    #[msg("Label exceeds the maximum length of 32 characters")]
    LabelTooLong,

    #[msg("New mode is identical to the current mode — no change needed")]
    SameMode,
}
