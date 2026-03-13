# SSS-7: Native SOL-Backed Stablecoin

| Field | Value |
|-------|-------|
| Standard | SSS-7 |
| Title | Decentralized SOL-Collateralized Stablecoin |
| Status | Draft |
| Requires | SSS-1, SSS Oracle Program |
| Use Case | Decentralized stablecoin backed by SOL collateral (analogous to DAI on Ethereum) |

---

## Abstract

SSS-7 defines a decentralized stablecoin where users lock SOL as collateral in a program-controlled vault and receive stablecoins in return. The stablecoin maintains its peg through over-collateralization requirements and a liquidation system that automatically seizes undercollateralized positions when the SOL price falls.

Unlike SSS-1 through SSS-6 (which are centralized issuer models), SSS-7 is a decentralized protocol where the program itself is the issuer.

---

## Architecture

```
User (borrower)
      │
      │  deposit_sol(amount)
      ▼
SOL Vault PDA
["sol_vault", collateral_config, user]
  ├── deposited_sol: u64 (lamports)
  └── (holds actual SOL lamports)
      │
      │  borrow_stablecoin(amount)
      ▼
CollateralPosition PDA
["collateral_position", collateral_config, user]
  ├── owner: Pubkey
  ├── deposited_sol: u64
  ├── minted_stablecoin: u64
  ├── last_fee_accrual: i64
  └── health: u128 (collateral ratio in BPS)
      │
      │  SSS Oracle Program reads SOL/USD price
      ▼
OracleConfig PDA
(Switchboard V2 SOL/USD feed)
  └── price: u64 (SOL price in USD with decimals)
```

---

## CollateralConfig PDA

**Seeds**: `["collateral_config", stablecoin_config]`

```rust
#[account]
pub struct CollateralConfig {
    /// The SSS StablecoinConfig this protocol mints
    pub stablecoin_config: Pubkey,
    /// The Oracle program's OracleConfig for SOL/USD pricing
    pub oracle_config: Pubkey,
    /// Minimum collateral ratio in BPS (e.g., 15000 = 150%)
    pub min_collateral_ratio_bps: u32,
    /// Collateral ratio at which liquidation is triggered (e.g., 13000 = 130%)
    pub liquidation_threshold_bps: u32,
    /// Percentage of collateral awarded to liquidator in BPS (e.g., 500 = 5%)
    pub liquidation_penalty_bps: u32,
    /// Annual stability fee in BPS (e.g., 200 = 2%)
    pub stability_fee_bps: u32,
    /// Authority who can update risk parameters
    pub authority: Pubkey,
    /// PDA bump
    pub bump: u8,
    /// Total SOL deposited across all positions (lamports)
    pub total_sol_deposited: u64,
    /// Total stablecoin outstanding from this protocol
    pub total_stablecoin_minted: u64,
}
```

---

## CollateralPosition PDA

**Seeds**: `["collateral_position", collateral_config, owner]`

```rust
#[account]
pub struct CollateralPosition {
    pub collateral_config: Pubkey,
    pub owner: Pubkey,
    /// SOL deposited in lamports
    pub deposited_sol: u64,
    /// Stablecoin minted against this collateral
    pub minted_stablecoin: u64,
    /// Unix timestamp of last stability fee accrual
    pub last_fee_accrual: i64,
    /// Accrued but uncollected stability fee (in stablecoin base units)
    pub accrued_fee: u64,
    /// PDA bump
    pub bump: u8,
}
```

---

## Health Factor Calculation

The health factor determines whether a position can be liquidated:

```
collateral_value_usd = deposited_sol_lamports * sol_price_usd / LAMPORTS_PER_SOL

// Health factor (as BPS)
health_bps = (collateral_value_usd * 10000) / minted_stablecoin

// Position is safe if:
health_bps >= min_collateral_ratio_bps  (150%)

// Position is liquidatable if:
health_bps < liquidation_threshold_bps  (130%)
```

In Rust (using u128 to avoid overflow):

```rust
pub fn calculate_health_bps(
    deposited_sol_lamports: u64,
    sol_price_per_token: u64,      // oracle: price with 6 decimals
    sol_price_decimals: u32,
    minted_stablecoin: u64,
    stablecoin_decimals: u32,
) -> u128 {
    // collateral_value = lamports * price / LAMPORTS_PER_SOL / 10^price_decimals
    let lamports_per_sol: u128 = 1_000_000_000;
    let price_scale: u128 = 10u128.pow(sol_price_decimals);
    let stable_scale: u128 = 10u128.pow(stablecoin_decimals);

    let collateral_usd_scaled: u128 = (deposited_sol_lamports as u128)
        .saturating_mul(sol_price_per_token as u128)
        .saturating_mul(stable_scale)
        / lamports_per_sol
        / price_scale;

    if minted_stablecoin == 0 {
        return u128::MAX; // Infinite health if no debt
    }

    collateral_usd_scaled
        .saturating_mul(10_000)
        / (minted_stablecoin as u128)
}
```

---

## Instructions

### `initialize_collateral_config`

Creates the `CollateralConfig` PDA, linking the SSS stablecoin to the oracle and setting risk parameters.

**Parameters**:
- `min_collateral_ratio_bps: u32` — e.g., 15000
- `liquidation_threshold_bps: u32` — e.g., 13000
- `liquidation_penalty_bps: u32` — e.g., 500
- `stability_fee_bps: u32` — e.g., 200

### `deposit_and_borrow`

Deposits SOL and mints stablecoin in one transaction.

```typescript
// Deposit $200 worth of SOL, borrow 100 CUSD (200% collateral ratio)
const solPrice = 100; // $100/SOL from oracle
const desiredBorrowUsd = 100; // $100 CUSD
const solToDeposit = 2 * LAMPORTS_PER_SOL; // $200 worth (2 SOL at $100)

await sss7Program.methods
  .depositAndBorrow(
    new BN(solToDeposit),
    new BN(desiredBorrowUsd).mul(new BN(1_000_000)) // 100 CUSD
  )
  .accounts({
    collateralConfig: collateralConfigPda,
    collateralPosition: positionPda,
    oracleConfig: oracleConfigPda,
    stablecoinConfig: sssConfigPda,
    minterQuota: programMinterQuotaPda,  // program holds Minter role
    roleAccount: programMinterRolePda,
    recipientTokenAccount: borrowerAta,
    mint: mintAddress,
    borrower: borrower.publicKey,
    systemProgram: SystemProgram.programId,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
```

### `repay_and_withdraw`

Repays stablecoin debt and retrieves SOL collateral.

```typescript
// Repay 50 CUSD and withdraw 1 SOL
await sss7Program.methods
  .repayAndWithdraw(
    new BN(50_000_000),      // 50 CUSD to repay
    new BN(LAMPORTS_PER_SOL) // 1 SOL to withdraw
  )
  .accounts({ /* ... */ })
  .rpc();
```

The program checks that the remaining position (if any) still meets the minimum collateral ratio after withdrawal.

### `liquidate`

Anyone can liquidate an undercollateralized position. The liquidator repays the debt and receives the collateral minus the penalty.

```typescript
// Liquidate a position below the threshold
// Liquidator repays the full debt and receives:
//   collateral * (1 + liquidation_penalty_bps / 10000)
await sss7Program.methods
  .liquidate(positionOwner)
  .accounts({
    collateralConfig: collateralConfigPda,
    collateralPosition: positionPda,
    oracleConfig: oracleConfigPda,
    liquidatorTokenAccount: liquidatorAta,
    liquidator: liquidator.publicKey,
    // ... SSS accounts for burning the repaid stablecoins
  })
  .rpc();
```

**Liquidation math**:
```
debt = position.minted_stablecoin + position.accrued_fee
collateral_to_seize_lamports = debt_usd_value * (10000 + penalty_bps) / 10000
                               / sol_price * LAMPORTS_PER_SOL
leftover_collateral = position.deposited_sol - collateral_to_seize_lamports
// leftover is returned to the position owner
```

### `accrue_stability_fee`

A permissionless crank that accrues the stability fee since last accrual. Should be called before any position modification.

```typescript
// Accrue stability fee for a position
const feeAccruedPerYear = minted * stability_fee_bps / 10000;
const feeAccruedThisPeriod = feeAccruedPerYear * elapsed_seconds / SECONDS_PER_YEAR;
```

---

## Oracle Integration

SSS-7 depends on the SSS Oracle program for real-time SOL/USD pricing:

```typescript
// Read the oracle price
const oracleConfig = await oracleProgram.account.oracleConfig.fetch(oracleConfigPda);

if (Date.now() / 1000 - oracleConfig.lastUpdated.toNumber() > oracleConfig.stalenessThreshold) {
  // Crank the oracle
  await oracleProgram.methods.refreshPrice().accounts({
    oracleConfig: oracleConfigPda,
    aggregator: switchboardSolUsdFeed,
    clock: SYSVAR_CLOCK_PUBKEY,
  }).rpc();
}

const solPrice = oracleConfig.price; // SOL/USD with oracle's price_decimals
```

---

## Stability Fee Mechanics

The stability fee is an annual interest rate on outstanding stablecoin debt. It is accrued continuously and must be repaid (in stablecoin) when the position is closed. Uncollected fees compound into the `accrued_fee` field.

```
fee_per_second = minted_stablecoin * stability_fee_bps / (10000 * SECONDS_PER_YEAR)
accrued_fee += fee_per_second * elapsed_seconds
```

Stability fees are burned when repaid, acting as a deflationary mechanism:

```rust
// On repay_and_withdraw:
let total_to_repay = repay_amount.checked_add(position.accrued_fee)?;
// Burn total_to_repay stablecoins from the borrower's account
position.minted_stablecoin = position.minted_stablecoin.checked_sub(repay_amount)?;
position.accrued_fee = 0;
```

---

## Risk Parameters (Recommended Defaults)

| Parameter | Recommended Value | Rationale |
|-----------|------------------|-----------|
| `min_collateral_ratio_bps` | 15000 (150%) | Standard DeFi overcollateralization |
| `liquidation_threshold_bps` | 13000 (130%) | 20% buffer before total undercollateralization |
| `liquidation_penalty_bps` | 500 (5%) | Incentivizes liquidators; not punitive |
| `stability_fee_bps` | 200 (2%) | Reflects cost of carry |
| Oracle staleness | 60 seconds | SOL price volatility requires fresh data |

---

## Comparison to MakerDAO (DAI)

| Aspect | MakerDAO / DAI | SSS-7 |
|--------|---------------|-------|
| Collateral | ETH, WBTC, USDC, etc. | SOL (SSS-8 adds multi-collateral) |
| Governance | MKR token governance | SSS master authority + Squads multisig |
| Stability fee | DSR (DAI Savings Rate) | `stability_fee_bps` on CollateralConfig |
| Liquidation | Keeper bots via Auction | Permissionless `liquidate` instruction |
| Price oracle | Chainlink / MakerDAO oracle | Switchboard V2 via SSS Oracle program |
| Over-collateralization | 150%+ | Configurable (`min_collateral_ratio_bps`) |
| Peg mechanism | Arbitrage + DSR | Redemption (`burn_tokens`) + overcollateralization |
