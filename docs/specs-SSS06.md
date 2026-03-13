# SSS-6: Streaming / Vesting Stablecoin

| Field | Value |
|-------|-------|
| Standard | SSS-6 |
| Title | Token Vesting and Streaming Payments |
| Status | Draft |
| Requires | SSS-1 |
| Use Case | Employee token grants, streaming salary, grant disbursements, investor vesting |

---

## Abstract

SSS-6 defines a vesting and streaming extension for SSS stablecoins. Tokens are locked in a program-controlled escrow at issuance and released to the beneficiary over time according to a configurable schedule. The release is continuous (stream) or cliff-based, calculated from the block timestamp.

---

## Use Cases

1. **Employee salary streaming**: A company pays employees in stablecoin, streamed second-by-second. Employees can claim accrued tokens at any time.

2. **Investor vesting**: A startup issues stablecoins to early investors with a 1-year cliff and 4-year linear vest. The vesting schedule is immutable after creation.

3. **Grant disbursement**: A DAO allocates grants to builders. Recipients receive monthly tranches based on milestone completion (cliff vesting).

4. **Contractor milestone payments**: 50% on start, 50% on delivery, with the delivery tranche streamed over the contract period.

---

## Architecture

```
VestingConfig PDA             VestingSchedule PDA
["vesting_config", config]    ["vesting_schedule", vesting_config, beneficiary]
      │                              │
      │                              ├── beneficiary: Pubkey
      │                              ├── start_time: i64
      │                              ├── cliff_time: i64
      │                              ├── end_time: i64
      │                              ├── total_amount: u64
      │                              ├── released_amount: u64
      │                              └── rate_per_second: u64
      │
      ▼
VestingEscrow TokenAccount
(held by vesting_config PDA)
      │
      └── Tokens released via claim_vested()
          → Transfers from escrow to beneficiary's ATA
```

---

## VestingSchedule PDA

**Seeds**: `["vesting_schedule", vesting_config, beneficiary]`

```rust
#[account]
pub struct VestingSchedule {
    /// The vesting config this schedule belongs to
    pub vesting_config: Pubkey,
    /// Beneficiary who will receive the vested tokens
    pub beneficiary: Pubkey,
    /// Unix timestamp when vesting starts (epoch start for linear calc)
    pub start_time: i64,
    /// Unix timestamp of the cliff (no tokens released before this)
    /// Set equal to start_time for no-cliff linear vesting
    pub cliff_time: i64,
    /// Unix timestamp when vesting is fully complete
    pub end_time: i64,
    /// Total tokens allocated to this schedule
    pub total_amount: u64,
    /// Tokens already released to the beneficiary
    pub released_amount: u64,
    /// Tokens per second (for display; actual calc uses timestamps)
    /// = (total_amount - cliff_amount) / (end_time - cliff_time)
    pub rate_per_second: u64,
    /// Amount released at the cliff (cliff_amount)
    pub cliff_amount: u64,
    /// PDA bump
    pub bump: u8,
    /// Whether the schedule can be cancelled by the authority
    pub revocable: bool,
    /// If cancelled, the remaining locked tokens go back to issuer
    pub cancelled_at: i64, // 0 = not cancelled
}
```

---

## Vesting Calculation

### Linear Vesting Formula

```
if now < cliff_time:
    vested = 0

elif now >= end_time:
    vested = total_amount

else:
    // Post-cliff linear interpolation
    elapsed = now - cliff_time
    total_duration = end_time - cliff_time
    linear_vested = cliff_amount + ((total_amount - cliff_amount) * elapsed) / total_duration
    vested = linear_vested

claimable = vested - released_amount
```

In Rust (using integer arithmetic to avoid floating point):

```rust
pub fn calculate_vested(schedule: &VestingSchedule, now: i64) -> u64 {
    if now < schedule.cliff_time {
        return 0;
    }
    if now >= schedule.end_time {
        return schedule.total_amount;
    }

    let elapsed = (now - schedule.cliff_time) as u64;
    let total_duration = (schedule.end_time - schedule.cliff_time) as u64;
    let post_cliff_amount = schedule.total_amount
        .saturating_sub(schedule.cliff_amount);

    schedule.cliff_amount
        .saturating_add(
            post_cliff_amount
                .saturating_mul(elapsed)
                .saturating_div(total_duration)
        )
}
```

### Cliff Vesting

For cliff-only vesting (100% at the cliff date, nothing before):

```
cliff_amount = total_amount
rate_per_second = 0
cliff_time = cliff_date
end_time = cliff_date  (or any time after)
```

The formula: `vested = total_amount if now >= cliff_time, else 0`

---

## Instructions

### `initialize_vesting_config`

Creates the root `VestingConfig` PDA linking to the stablecoin.

**Accounts**:
- `vesting_config`: init PDA `["vesting_config", stablecoin_config]`
- `stablecoin_config`: the SSS config
- `authority`: the vesting config authority (can create/cancel schedules)
- `system_program`

### `create_vesting_schedule`

Creates a new `VestingSchedule` and mints (or transfers) tokens into the escrow account.

**Parameters**:
- `beneficiary: Pubkey`
- `total_amount: u64`
- `start_time: i64`
- `cliff_time: i64`
- `end_time: i64`
- `cliff_amount: u64`
- `revocable: bool`

**Accounts**:
- `vesting_schedule`: init PDA `["vesting_schedule", vesting_config, beneficiary]`
- `vesting_config`: the root config PDA
- `vesting_escrow_token_account`: the token account held by vesting_config PDA
- `authority`: the vesting authority
- `minter_quota`: the SSS MinterQuota for the authority
- `role_account`: the SSS RoleAccount (Minter) for the authority
- `sss_config`: the SSS StablecoinConfig
- `mint`: the Token-2022 mint
- `token_program`, `system_program`

**Flow**:
1. Verify authority has Minter role in SSS
2. CPI to SSS `mint_tokens` → mints `total_amount` to vesting escrow
3. Initialize VestingSchedule PDA
4. Emit `VestingScheduleCreated` event

### `claim_vested`

Claims the currently vested but unclaimed tokens.

**Accounts**:
- `vesting_schedule`: the schedule PDA
- `vesting_config`: the root config (PDA signer for escrow transfers)
- `vesting_escrow_token_account`: source (the escrow)
- `beneficiary_token_account`: destination (beneficiary's ATA)
- `beneficiary`: must be the signer
- `clock`: `SysvarC1ock11111111111111111111111111111111`
- `token_program`

**Flow**:
1. Read `clock.unix_timestamp`
2. Calculate `vested = calculate_vested(schedule, now)`
3. Calculate `claimable = vested - schedule.released_amount`
4. Require `claimable > 0`
5. CPI: Token-2022 `transfer_checked` from escrow to beneficiary (config PDA signs)
6. Update `schedule.released_amount += claimable`
7. Emit `TokensClaimed { beneficiary, amount: claimable, total_released }`

### `cancel_vesting_schedule`

For revocable schedules, the authority can cancel. Unvested tokens return to the issuer.

**Flow**:
1. Verify `schedule.revocable == true`
2. Calculate `vested_at_cancel = calculate_vested(schedule, now)`
3. `returnable = total_amount - max(vested_at_cancel, released_amount)`
4. Transfer `returnable` from escrow back to issuer token account
5. Set `schedule.cancelled_at = now`
6. Emit `VestingScheduleCancelled`

---

## Integration with SSS-1

SSS-6 builds on SSS-1 by using the SSS minting system to fund the escrow. The vesting authority holds a `MinterQuota` PDA and mints directly into the escrow:

```typescript
// Create a 4-year linear vesting schedule with 1-year cliff
const now = Math.floor(Date.now() / 1000);
const ONE_YEAR = 365 * 24 * 60 * 60;

await vestingProgram.methods.createVestingSchedule({
  beneficiary: employeeWallet,
  totalAmount: new BN(100_000).mul(new BN(1_000_000)), // 100,000 CUSD
  startTime: new BN(now),
  cliffTime: new BN(now + ONE_YEAR),         // 1-year cliff
  endTime: new BN(now + 4 * ONE_YEAR),       // 4 years total
  cliffAmount: new BN(25_000).mul(new BN(1_000_000)), // 25% at cliff
  revocable: true,                            // Company can cancel if employee leaves
}).accounts({
  vestingSchedule: vestingSchedulePda,
  vestingConfig: vestingConfigPda,
  vestingEscrow: vestingEscrowAta,
  authority: hrKeypair.publicKey,
  // SSS accounts for minting
  minterQuota: hrMinterQuotaPda,
  roleAccount: hrMinterRolePda,
  sssConfig: stablecoinConfigPda,
  mint: mintAddress,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
}).rpc();
```

---

## Cliff vs Linear Comparison

| Schedule Type | cliff_amount | cliff_time | end_time | Example |
|--------------|-------------|------------|----------|---------|
| Full cliff | `total_amount` | vest_date | vest_date | All tokens on a specific date |
| Linear (no cliff) | `0` | start_time | end_time | Smooth daily release |
| 25% cliff + 75% linear | `0.25 * total` | 1yr | 4yr | Standard employee vesting |
| Milestone tranches | Per milestone | Per milestone date | Last date | Project-based grants |
| Monthly tranches | `total/12` | Each month start | Each month start | Monthly salary |

---

## Events

```rust
#[event]
pub struct VestingScheduleCreated {
    pub vesting_config: Pubkey,
    pub beneficiary: Pubkey,
    pub total_amount: u64,
    pub start_time: i64,
    pub cliff_time: i64,
    pub end_time: i64,
    pub revocable: bool,
}

#[event]
pub struct TokensClaimed {
    pub vesting_schedule: Pubkey,
    pub beneficiary: Pubkey,
    pub amount_claimed: u64,
    pub total_released: u64,
    pub remaining_locked: u64,
}

#[event]
pub struct VestingScheduleCancelled {
    pub vesting_schedule: Pubkey,
    pub beneficiary: Pubkey,
    pub returned_amount: u64,
    pub cancelled_by: Pubkey,
    pub cancelled_at: i64,
}
```

---

## Security Considerations

1. **Non-revocable schedules**: When `revocable = false`, the beneficiary's future claims are guaranteed by the on-chain escrow. The issuer cannot claw back tokens.

2. **Clock manipulation**: The `clock.unix_timestamp` is derived from the validator network's median time. It cannot be manipulated by the user or the program.

3. **Escrow ownership**: The escrow token account is owned by the `vesting_config` PDA, not the authority. The authority cannot withdraw escrowed tokens except through the `cancel_vesting_schedule` path (for revocable schedules).

4. **Supply accounting**: Tokens minted into the escrow are counted in `total_minted`. This correctly reflects the circulating commitment even before the beneficiary claims. Auditors should note that escrowed tokens are issued but not liquid.
