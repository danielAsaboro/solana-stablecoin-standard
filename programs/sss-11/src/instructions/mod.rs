//! Instruction handlers for the SSS-11 Credit Stablecoin program.
//!
//! Each sub-module defines an Anchor `Accounts` context struct and a `handler`
//! function. The program entry points in [`lib.rs`](crate::sss_11) delegate to
//! these handlers via qualified paths.
//!
//! | Instruction                 | Module                  | Who can call       |
//! |-----------------------------|-------------------------|--------------------|
//! | `initialize_credit_config`  | [`initialize`]          | Anyone (creator)   |
//! | `open_position`             | [`open_position`]       | Any borrower       |
//! | `deposit_collateral`        | [`deposit_collateral`]  | Position owner     |
//! | `issue_credit`              | [`issue_credit`]        | Position owner     |
//! | `repay`                     | [`repay`]               | Position owner     |
//! | `withdraw_collateral`       | [`withdraw_collateral`] | Position owner     |
//! | `liquidate`                 | [`liquidate`]           | Anyone (if unhealthy) |

pub mod initialize;
pub mod open_position;
pub mod deposit_collateral;
pub mod issue_credit;
pub mod repay;
pub mod withdraw_collateral;
pub mod liquidate;

#[allow(ambiguous_glob_reexports)]
pub use initialize::*;
pub use open_position::*;
pub use deposit_collateral::*;
pub use issue_credit::*;
pub use repay::*;
pub use withdraw_collateral::*;
pub use liquidate::*;
