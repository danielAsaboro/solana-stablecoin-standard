//! Instruction handlers for the SSS program.
//!
//! Each sub-module defines an Anchor `Accounts` context struct and a `handler`
//! function. The program entry points in [`lib.rs`](crate::sss) delegate to
//! these handlers via qualified paths.
//!
//! ## Core instructions (all presets)
//!
//! | Instruction                    | Module                    | Role required    |
//! |--------------------------------|---------------------------|------------------|
//! | `initialize`                   | [`initialize`]            | None (creator)   |
//! | `mint_tokens`                  | [`mint`]                  | Minter           |
//! | `burn_tokens`                  | [`burn`]                  | Burner           |
//! | `freeze_token_account`         | [`freeze_account`]        | Pauser           |
//! | `thaw_token_account`           | [`thaw_account`]          | Pauser           |
//! | `pause`                        | [`pause`]                 | Pauser           |
//! | `unpause`                      | [`unpause`]               | Pauser           |
//! | `assign_role`                  | [`assign_role`]           | Master authority |
//! | `update_role`                  | [`update_role`]           | Master authority |
//! | `update_minter`                | [`update_minter`]         | Master authority |
//! | `reset_minter_quota`           | [`reset_minter_quota`]    | Master authority |
//! | `transfer_authority`           | [`transfer_authority`]    | Master authority |
//! | `propose_authority_transfer`   | [`propose_authority`]     | Master authority |
//! | `accept_authority_transfer`    | [`accept_authority`]      | Pending authority|
//! | `cancel_authority_transfer`    | [`cancel_authority`]      | Master authority |
//!
//! ## SSS-2 compliance instructions
//!
//! | Instruction              | Module                    | Role required |
//! |--------------------------|---------------------------|---------------|
//! | `add_to_blacklist`       | [`add_to_blacklist`]      | Blacklister   |
//! | `remove_from_blacklist`  | [`remove_from_blacklist`] | Blacklister   |
//! | `seize`                  | [`seize`]                 | Seizer        |
//!
//! ## View instructions (read-only)
//!
//! | Instruction         | Module  | Returns             |
//! |---------------------|---------|---------------------|
//! | `get_supply_info`   | [`view`]| `SupplyInfo`        |
//! | `get_minter_info`   | [`view`]| `MinterInfo`        |
//! | `preview_mint`      | [`view`]| `PreviewMintResult` |
//! | `is_blacklisted`    | [`view`]| `bool`              |
//! | `get_config`        | [`view`]| `ConfigInfo`        |

pub mod accept_authority;
pub mod add_to_blacklist;
pub mod assign_role;
pub mod burn;
pub mod cancel_authority;
pub mod freeze_account;
pub mod initialize;
pub mod mint;
pub mod pause;
pub mod propose_authority;
pub mod remove_from_blacklist;
pub mod reset_minter_quota;
pub mod seize;
pub mod thaw_account;
pub mod transfer_authority;
pub mod unpause;
pub mod update_minter;
pub mod update_role;
pub mod view;

// Glob re-exports are required for Anchor-generated __client_accounts_* modules.
// The `handler` name collision is harmless — lib.rs calls handlers via qualified paths.
#[allow(ambiguous_glob_reexports)]
pub use accept_authority::*;
pub use add_to_blacklist::*;
#[allow(ambiguous_glob_reexports)]
pub use assign_role::*;
pub use burn::*;
pub use cancel_authority::*;
pub use freeze_account::*;
#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
pub use mint::*;
pub use pause::*;
pub use propose_authority::*;
pub use remove_from_blacklist::*;
pub use reset_minter_quota::*;
pub use seize::*;
pub use thaw_account::*;
pub use transfer_authority::*;
pub use unpause::*;
pub use update_minter::*;
#[allow(ambiguous_glob_reexports)]
pub use update_role::*;
pub use view::*;
