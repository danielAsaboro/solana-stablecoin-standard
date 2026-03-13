//! Instruction handlers for the SSS-10 Async Mint/Redeem program.
//!
//! Each sub-module defines an Anchor `Accounts` context struct and a `handler`
//! function. The program entry points in [`lib.rs`](crate::sss_10) delegate to
//! these handlers via qualified paths.
//!
//! | Instruction               | Module                  | Who can call          |
//! |---------------------------|-------------------------|-----------------------|
//! | `initialize_async_config` | [`initialize`]          | Anyone (creator)      |
//! | `request_mint`            | [`request_mint`]        | Anyone                |
//! | `approve_mint`            | [`approve_mint`]        | Authority             |
//! | `reject_mint`             | [`reject_mint`]         | Authority             |
//! | `execute_mint`            | [`execute_mint`]        | Anyone (if Approved)  |
//! | `cancel_mint_request`     | [`cancel_mint_request`] | Original requester    |
//! | `request_redeem`          | [`request_redeem`]      | Anyone                |
//! | `approve_redeem`          | [`approve_redeem`]      | Authority             |
//! | `execute_redeem`          | [`execute_redeem`]      | Anyone (if Approved)  |

pub mod initialize;
pub mod request_mint;
pub mod approve_mint;
pub mod reject_mint;
pub mod execute_mint;
pub mod cancel_mint_request;
pub mod request_redeem;
pub mod approve_redeem;
pub mod execute_redeem;

#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
pub use request_mint::*;
pub use approve_mint::*;
pub use reject_mint::*;
pub use execute_mint::*;
pub use cancel_mint_request::*;
pub use request_redeem::*;
pub use approve_redeem::*;
pub use execute_redeem::*;
