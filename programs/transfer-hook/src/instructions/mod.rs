//! Instruction handlers for the transfer hook program.
//!
//! - [`initialize_extra_account_metas`]: One-time setup of the account resolution
//!   recipe so Token-2022 knows which extra accounts to pass to the hook.
//! - [`transfer_hook`]: The hook handler invoked on every `transfer_checked`,
//!   enforcing blacklist checks.

pub mod initialize_extra_account_metas;
pub mod transfer_hook;

// Glob re-exports are required for Anchor-generated __client_accounts_* modules.
#[allow(ambiguous_glob_reexports)]
pub use initialize_extra_account_metas::*;
pub use transfer_hook::*;
