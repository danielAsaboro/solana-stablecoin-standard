//! Oracle instruction handlers.
//!
//! | Instruction             | Module                  | Required Role     |
//! |-------------------------|-------------------------|-------------------|
//! | `initialize_oracle`     | [`initialize`]          | Config authority   |
//! | `update_oracle_config`  | [`update_config`]       | Oracle authority   |
//! | `refresh_price`         | [`refresh_price`]       | Any signer        |
//! | `push_manual_price`     | [`push_price`]          | Oracle authority   |

pub mod initialize;
pub mod push_price;
pub mod refresh_price;
pub mod update_config;

// Glob re-exports are required for Anchor-generated __client_accounts_* modules.
// The `handler` name collision is harmless — lib.rs calls handlers via qualified paths.
#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
pub use push_price::*;
pub use refresh_price::*;
pub use update_config::*;
