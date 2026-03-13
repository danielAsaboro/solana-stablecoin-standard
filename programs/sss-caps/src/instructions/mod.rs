//! Instruction handlers for the SSS Caps program.
//!
//! Each sub-module defines an Anchor `Accounts` context struct and a `handler`
//! function. The program entry points in [`lib.rs`](crate::sss_caps) delegate
//! to these handlers via qualified paths.
//!
//! | Instruction               | Module                      | Authority required |
//! |---------------------------|-----------------------------|--------------------|
//! | `initialize_caps_config`  | [`initialize_caps_config`]  | Creator (signer)   |
//! | `update_caps_config`      | [`update_caps_config`]      | Caps authority     |

pub mod initialize_caps_config;
pub mod update_caps_config;

#[allow(ambiguous_glob_reexports)]
pub use initialize_caps_config::*;
pub use update_caps_config::*;
