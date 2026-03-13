//! Instruction handlers for the SSS Timelock program.
//!
//! Each sub-module defines an Anchor `Accounts` context struct and a `handler`
//! function. The program entry points in [`lib.rs`](crate::sss_timelock) delegate
//! to these handlers via qualified paths.
//!
//! | Instruction           | Module                  | Authority required       |
//! |-----------------------|-------------------------|--------------------------|
//! | `initialize_timelock` | [`initialize_timelock`] | Creator (signer)         |
//! | `propose_operation`   | [`propose_operation`]   | Any signer               |
//! | `execute_operation`   | [`execute_operation`]   | Any signer (after delay) |
//! | `cancel_operation`    | [`cancel_operation`]    | Timelock authority       |

pub mod cancel_operation;
pub mod execute_operation;
pub mod initialize_timelock;
pub mod propose_operation;

#[allow(ambiguous_glob_reexports)]
pub use cancel_operation::*;
pub use execute_operation::*;
pub use initialize_timelock::*;
pub use propose_operation::*;
