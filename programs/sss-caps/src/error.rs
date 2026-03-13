//! Custom error codes for the SSS Caps module.
//!
//! Each variant maps to a unique Anchor error code and includes a human-readable
//! message returned to clients.

use anchor_lang::prelude::*;

/// Errors that can be returned by SSS Caps program instructions.
#[error_code]
pub enum CapsError {
    #[msg("Unauthorized - caller is not the caps authority")]
    Unauthorized,

    #[msg("New caps are identical to current caps — no change needed")]
    SameCaps,
}
