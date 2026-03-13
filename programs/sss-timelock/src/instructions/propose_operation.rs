//! Propose a governance operation subject to the timelock delay.

use anchor_lang::prelude::*;

use crate::error::TimelockError;
use crate::events::OperationProposed;
use crate::state::{OperationType, PendingOp, TimelockConfig};

/// Accounts required to propose a new timelocked operation.
#[derive(Accounts)]
#[instruction(operation_type: OperationType, op_id: u64)]
pub struct ProposeOperation<'info> {
    /// The proposer. Any signer may propose operations — execution eligibility
    /// is enforced by the timelock delay and the authority check on execution.
    #[account(mut)]
    pub proposer: Signer<'info>,

    /// The timelock configuration PDA.
    #[account(
        seeds = [TimelockConfig::SEED_PREFIX, timelock_config.stablecoin_config.as_ref()],
        bump = timelock_config.bump,
    )]
    pub timelock_config: Account<'info, TimelockConfig>,

    /// The pending operation PDA to create. Uniquely identified by `op_id`.
    #[account(
        init,
        payer = proposer,
        space = PendingOp::LEN,
        seeds = [PendingOp::SEED_PREFIX, timelock_config.key().as_ref(), &op_id.to_le_bytes()],
        bump,
    )]
    pub pending_op: Account<'info, PendingOp>,

    pub system_program: Program<'info, System>,
}

/// Create a [`PendingOp`] that may be executed after `delay_seconds` elapses.
///
/// `valid_after` is set to `Clock::unix_timestamp + delay_seconds`. The
/// `executed` and `cancelled` flags are initialized to `false`. Emits
/// [`OperationProposed`].
pub fn handler(
    ctx: Context<ProposeOperation>,
    operation_type: OperationType,
    op_id: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let delay = ctx.accounts.timelock_config.delay_seconds;
    let valid_after = clock
        .unix_timestamp
        .checked_add(delay as i64)
        .ok_or(TimelockError::ArithmeticOverflow)?;

    let op_type_byte: u8 = match &operation_type {
        OperationType::AuthorityTransfer => 0,
        OperationType::SupplyCapUpdate => 1,
        OperationType::PauseProtocol => 2,
        OperationType::UpdateRoles => 3,
    };

    let pending_op = &mut ctx.accounts.pending_op;
    pending_op.timelock_config = ctx.accounts.timelock_config.key();
    pending_op.operation_type = operation_type;
    pending_op.initiator = ctx.accounts.proposer.key();
    pending_op.valid_after = valid_after;
    pending_op.executed = false;
    pending_op.cancelled = false;
    pending_op.bump = ctx.bumps.pending_op;

    emit!(OperationProposed {
        timelock_config: ctx.accounts.timelock_config.key(),
        op_id,
        operation_type: op_type_byte,
        valid_after,
        initiator: ctx.accounts.proposer.key(),
    });

    Ok(())
}
