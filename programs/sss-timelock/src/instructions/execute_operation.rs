//! Execute a pending timelocked operation once the delay has elapsed.

use anchor_lang::prelude::*;

use crate::error::TimelockError;
use crate::events::OperationExecuted;
use crate::state::{PendingOp, TimelockConfig};

/// Accounts required to execute a timelocked operation.
#[derive(Accounts)]
#[instruction(op_id: u64)]
pub struct ExecuteOperation<'info> {
    /// The executor. Any signer may execute an eligible operation.
    pub executor: Signer<'info>,

    /// The timelock configuration PDA.
    #[account(
        seeds = [TimelockConfig::SEED_PREFIX, timelock_config.stablecoin_config.as_ref()],
        bump = timelock_config.bump,
    )]
    pub timelock_config: Account<'info, TimelockConfig>,

    /// The pending operation PDA to mark as executed.
    #[account(
        mut,
        seeds = [PendingOp::SEED_PREFIX, timelock_config.key().as_ref(), &op_id.to_le_bytes()],
        bump = pending_op.bump,
    )]
    pub pending_op: Account<'info, PendingOp>,
}

/// Mark a [`PendingOp`] as executed if the timelock delay has elapsed.
///
/// Fails with:
/// - [`TimelockError::AlreadyExecuted`] — if already executed.
/// - [`TimelockError::AlreadyCancelled`] — if already cancelled.
/// - [`TimelockError::OperationNotReady`] — if `clock < valid_after`.
///
/// Emits [`OperationExecuted`].
pub fn handler(ctx: Context<ExecuteOperation>, op_id: u64) -> Result<()> {
    let pending_op = &mut ctx.accounts.pending_op;

    require!(!pending_op.executed, TimelockError::AlreadyExecuted);
    require!(!pending_op.cancelled, TimelockError::AlreadyCancelled);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= pending_op.valid_after,
        TimelockError::OperationNotReady
    );

    pending_op.executed = true;

    emit!(OperationExecuted {
        timelock_config: ctx.accounts.timelock_config.key(),
        op_id,
        executed_by: ctx.accounts.executor.key(),
    });

    Ok(())
}
