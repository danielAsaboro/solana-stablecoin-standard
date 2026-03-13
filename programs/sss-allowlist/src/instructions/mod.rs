//! Instruction handlers for the SSS Allowlist program.
//!
//! Each sub-module defines an Anchor `Accounts` context struct and a `handler`
//! function. The program entry points in [`lib.rs`](crate::sss_allowlist) delegate
//! to these handlers via qualified paths.
//!
//! | Instruction                    | Module                        | Authority required   |
//! |--------------------------------|-------------------------------|----------------------|
//! | `initialize_allowlist_config`  | [`initialize_allowlist_config`] | Creator (signer)   |
//! | `update_allowlist_mode`        | [`update_allowlist_mode`]     | Allowlist authority  |
//! | `add_to_allowlist`             | [`add_to_allowlist`]          | Allowlist authority  |
//! | `remove_from_allowlist`        | [`remove_from_allowlist`]     | Allowlist authority  |

pub mod add_to_allowlist;
pub mod initialize_allowlist_config;
pub mod remove_from_allowlist;
pub mod update_allowlist_mode;

#[allow(ambiguous_glob_reexports)]
pub use add_to_allowlist::*;
pub use initialize_allowlist_config::*;
pub use remove_from_allowlist::*;
pub use update_allowlist_mode::*;
