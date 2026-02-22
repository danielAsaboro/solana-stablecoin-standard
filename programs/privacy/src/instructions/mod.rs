//! Privacy program instruction handlers.
//!
//! | Instruction               | Module                    | Required Role      |
//! |---------------------------|---------------------------|--------------------|
//! | `initialize_privacy`      | [`initialize`]            | Config authority    |
//! | `update_privacy_config`   | [`update_config`]         | Privacy authority   |
//! | `add_to_allowlist`        | [`add_to_allowlist`]      | Privacy authority   |
//! | `remove_from_allowlist`   | [`remove_from_allowlist`] | Privacy authority   |

pub mod initialize;
pub mod update_config;
pub mod add_to_allowlist;
pub mod remove_from_allowlist;

// Glob re-exports are required for Anchor-generated __client_accounts_* modules.
// The `handler` name collision is harmless — lib.rs calls handlers via qualified paths.
#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
pub use update_config::*;
pub use add_to_allowlist::*;
pub use remove_from_allowlist::*;
