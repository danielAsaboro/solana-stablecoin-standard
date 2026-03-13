//! Cancel a pending timelocked operation before it is executed.

use anchor_lang::prelude::*;

use crate::error::TimelockError;
use crate::events::OperationCancelled;
use crate::state::{PendingOp, TimelockConfig};

/// Accounts required to cancel a timelocked operation.
#[derive(Accounts)]
#[instruction(op_id: u64)]
pub struct CancelOperation<'info> {
    /// The timelock authority — must match `timelock_config.authority`.
    pub authority: Signer<'info>,

    /// The timelock configuration PDA.
    #[account(
        seeds = [TimelockConfig::SEED_PREFIX, timelock_config.stablecoin_config.as_ref()],
        bump = timelock_config.bump,
        constraint = timelock_config.authority == authority.key() @ TimelockError::Unauthorized,
    )]
    pub timelock_config: Account<'info, TimelockConfig>,

    /// The pending operation PDA to mark as cancelled.
    #[account(
        mut,
        seeds = [PendingOp::SEED_PREFIX, timelock_config.key().as_ref(), &op_id.to_le_bytes()],
        bump = pending_op.bump,
    )]
    pub pending_op: Account<'info, PendingOp>,
}

/// Mark a [`PendingOp`] as cancelled.
///
/// Only the timelock authority may cancel an operation. Fails with:
/// - [`TimelockError::AlreadyExecuted`] — if the operation has already been executed.
/// - [`TimelockError::AlreadyCancelled`] — if already cancelled.
///
/// Emits [`OperationCancelled`].
pub fn handler(ctx: Context<CancelOperation>, op_id: u64) -> Result<()> {
    let pending_op = &mut ctx.accounts.pending_op;

    require!(!pending_op.executed, TimelockError::AlreadyExecuted);
    require!(!pending_op.cancelled, TimelockError::AlreadyCancelled);

    pending_op.cancelled = true;

    emit!(OperationCancelled {
        timelock_config: ctx.accounts.timelock_config.key(),
        op_id,
        cancelled_by: ctx.accounts.authority.key(),
    });

    Ok(())
}
