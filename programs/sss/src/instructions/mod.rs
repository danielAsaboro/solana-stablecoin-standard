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
