//! # SSS Timelock — Composable Governance Delay Module
//!
//! An Anchor program providing timelock governance for sensitive operations in
//! the Solana Stablecoin Standard. Any privileged action (authority transfer,
//! supply cap update, pause, role update) can be wrapped in a [`PendingOp`]
//! that cannot be executed until a configurable delay has elapsed.
//!
//! ## Flow
//!
//! 1. Deploy this program alongside the main SSS program.
//! 2. Call [`initialize_timelock`](sss_timelock::initialize_timelock) once per
//!    stablecoin, providing `delay_seconds`.
//! 3. Before executing a sensitive operation, call
//!    [`propose_operation`](sss_timelock::propose_operation) with a unique `op_id`
//!    and an [`OperationType`](state::OperationType) variant.
//! 4. Wait for `delay_seconds` to elapse on-chain.
//! 5. Call [`execute_operation`](sss_timelock::execute_operation) — this marks the
//!    [`PendingOp`](state::PendingOp) as executed. The caller is then responsible
//!    for executing the actual privileged instruction in the same or a subsequent
//!    transaction (referencing the executed PDA as proof of governance approval).
//! 6. The authority may call [`cancel_operation`](sss_timelock::cancel_operation)
//!    at any time before execution to abort a pending operation.
//!
//! ## Checked arithmetic
//!
//! All instructions use checked arithmetic and return
//! [`TimelockError`](error::TimelockError) on unexpected conditions.

#![deny(clippy::all)]
// Anchor-generated code triggers these — safe to allow at crate level.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]
#![allow(clippy::result_large_err)]

pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

// Program ID placeholder — replaced by `anchor build` keypair.
declare_id!("GiaLNcvaFdao6py7cdDdRVGeu57P2hFcaRPYEVZf2YJ3");

#[program]
pub mod sss_timelock {
    use super::*;

    /// Initialize a new [`TimelockConfig`](state::TimelockConfig) for a stablecoin.
    ///
    /// `delay_seconds` must be greater than zero. The transaction signer becomes
    /// the timelock authority.
    pub fn initialize_timelock(
        ctx: Context<InitializeTimelock>,
        delay_seconds: u64,
    ) -> Result<()> {
        instructions::initialize_timelock::handler(ctx, delay_seconds)
    }

    /// Propose a governance operation subject to the timelock delay.
    ///
    /// Creates a [`PendingOp`](state::PendingOp) that becomes eligible for
    /// execution after `delay_seconds` from the proposal timestamp.
    pub fn propose_operation(
        ctx: Context<ProposeOperation>,
        operation_type: state::OperationType,
        op_id: u64,
    ) -> Result<()> {
        instructions::propose_operation::handler(ctx, operation_type, op_id)
    }

    /// Execute a pending operation once the delay has elapsed.
    ///
    /// Marks the [`PendingOp`](state::PendingOp) as executed. The caller is
    /// responsible for performing the actual privileged action.
    pub fn execute_operation(ctx: Context<ExecuteOperation>, op_id: u64) -> Result<()> {
        instructions::execute_operation::handler(ctx, op_id)
    }

    /// Cancel a pending operation before it is executed. Timelock authority only.
    ///
    /// Once cancelled, the operation may not be executed. A new proposal with a
    /// different `op_id` must be submitted to retry the operation.
    pub fn cancel_operation(ctx: Context<CancelOperation>, op_id: u64) -> Result<()> {
        instructions::cancel_operation::handler(ctx, op_id)
    }
}
