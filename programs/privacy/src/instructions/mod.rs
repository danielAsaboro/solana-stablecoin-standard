//! Privacy program instruction handlers.
//!
//! | Instruction               | Module                    | Required Role      |
//! |---------------------------|---------------------------|--------------------|
//! | `initialize_privacy`      | [`initialize`]            | Config authority    |
//! | `update_privacy_config`   | [`update_config`]         | Privacy authority   |
//! | `add_to_allowlist`        | [`add_to_allowlist`]      | Privacy authority   |
//! | `remove_from_allowlist`   | [`remove_from_allowlist`] | Privacy authority   |

pub mod add_to_allowlist;
pub mod initialize;
pub mod remove_from_allowlist;
pub mod update_config;

// Glob re-exports are required for Anchor-generated __client_accounts_* modules.
// The `handler` name collision is harmless — lib.rs calls handlers via qualified paths.
pub use add_to_allowlist::*;
#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
pub use remove_from_allowlist::*;
pub use update_config::*;
