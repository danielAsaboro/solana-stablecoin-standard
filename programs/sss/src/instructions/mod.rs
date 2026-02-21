//! Instruction handlers for the SSS program.
//!
//! Each sub-module defines an Anchor `Accounts` context struct and a `handler`
//! function. The program entry points in [`lib.rs`](crate::sss) delegate to
//! these handlers via qualified paths.
//!
//! ## Core instructions (all presets)
//!
//! | Instruction            | Module               | Role required    |
//! |------------------------|----------------------|------------------|
//! | `initialize`           | [`initialize`]       | None (creator)   |
//! | `mint_tokens`          | [`mint`]             | Minter           |
//! | `burn_tokens`          | [`burn`]             | Burner           |
//! | `freeze_token_account` | [`freeze_account`]   | Pauser           |
//! | `thaw_token_account`   | [`thaw_account`]     | Pauser           |
//! | `pause`                | [`pause`]            | Pauser           |
//! | `unpause`              | [`unpause`]          | Pauser           |
//! | `update_roles`         | [`update_roles`]     | Master authority |
//! | `update_minter`        | [`update_minter`]    | Master authority |
//! | `transfer_authority`   | [`transfer_authority`] | Master authority |
//!
//! ## SSS-2 compliance instructions
//!
//! | Instruction              | Module                    | Role required |
//! |--------------------------|---------------------------|---------------|
//! | `add_to_blacklist`       | [`add_to_blacklist`]      | Blacklister   |
//! | `remove_from_blacklist`  | [`remove_from_blacklist`] | Blacklister   |
//! | `seize`                  | [`seize`]                 | Seizer        |

pub mod initialize;
pub mod mint;
pub mod burn;
pub mod freeze_account;
pub mod thaw_account;
pub mod pause;
pub mod unpause;
pub mod update_roles;
pub mod update_minter;
pub mod transfer_authority;
pub mod add_to_blacklist;
pub mod remove_from_blacklist;
pub mod seize;

// Glob re-exports are required for Anchor-generated __client_accounts_* modules.
// The `handler` name collision is harmless — lib.rs calls handlers via qualified paths.
#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
pub use mint::*;
pub use burn::*;
pub use freeze_account::*;
pub use thaw_account::*;
pub use pause::*;
pub use unpause::*;
pub use update_roles::*;
pub use update_minter::*;
pub use transfer_authority::*;
pub use add_to_blacklist::*;
pub use remove_from_blacklist::*;
pub use seize::*;
