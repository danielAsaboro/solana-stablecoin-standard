# SSS-11: Credit Stablecoin

| Field | Value |
|-------|-------|
| Standard | SSS-11 |
| Title | Credit-Backed Stablecoin with Collateralized Positions |
| Status | Final |
| Program | `sss-11` |
| Program Seeds | `credit_config`, `credit_position` |

---

## Abstract

SSS-11 implements a credit-based stablecoin system where users open collateralized debt positions (CDPs). Users deposit collateral tokens into a program-controlled vault and receive stablecoins up to a maximum loan-to-value ratio. If collateral value falls below a liquidation threshold, anyone can liquidate the position and receive a bonus on the seized collateral.

This is analogous to MakerDAO's Vault system (formerly CDPs) on Ethereum, adapted for Solana's account model and the SSS stablecoin framework.

---

## Architecture

```
CreditConfig PDA
["credit_config", stablecoin_config]
  ├── stablecoin_config: Pubkey
  ├── oracle_config: Pubkey           (SSS Oracle for collateral pricing)
  ├── collateral_mint: Pubkey         (accepted collateral token)
  ├── min_collateral_ratio_bps: u32   (e.g., 15000 = 150%)
  ├── liquidation_threshold_bps: u32  (e.g., 13000 = 130%)
  ├── liquidation_penalty_bps: u32    (e.g., 500 = 5%)
  ├── stability_fee_bps: u32          (annual interest, e.g., 200 = 2%)
  ├── authority: Pubkey
  ├── total_collateral_deposited: u64
  ├── total_stablecoin_issued: u64
  └── bump: u8

CreditPosition PDA
["credit_position", credit_config, borrower]
  ├── credit_config: Pubkey
  ├── borrower: Pubkey
  ├── collateral_amount: u64          (collateral deposited)
  ├── debt_amount: u64                (stablecoin minted)
  ├── last_fee_accrual: i64           (Unix timestamp)
  ├── accrued_fee: u64                (accumulated stability fee)
  └── bump: u8

CreditVault TokenAccount
(held by credit_config PDA as authority)
  └── Collateral tokens deposited by all borrowers
```

---

## CreditConfig Account

```rust
#[account]
pub struct CreditConfig {
    pub stablecoin_config: Pubkey,
    pub oracle_config: Pubkey,
    pub collateral_mint: Pubkey,
    pub min_collateral_ratio_bps: u32,
    pub liquidation_threshold_bps: u32,
    pub liquidation_penalty_bps: u32,
    pub stability_fee_bps: u32,
    pub authority: Pubkey,
    pub total_collateral_deposited: u64,
    pub total_stablecoin_issued: u64,
    pub bump: u8,
}

impl CreditConfig {
    pub const SEED_PREFIX: &'static [u8] = b"credit_config";
}
```

## CreditPosition Account

```rust
#[account]
pub struct CreditPosition {
    pub credit_config: Pubkey,
    pub borrower: Pubkey,
    pub collateral_amount: u64,
    pub debt_amount: u64,
    pub last_fee_accrual: i64,
    pub accrued_fee: u64,
    pub bump: u8,
}

impl CreditPosition {
    pub const SEED_PREFIX: &'static [u8] = b"credit_position";
}
```

---

## Health Factor and Collateral Ratio

### Calculation

```
collateral_value_usd = collateral_amount * oracle_price / collateral_decimals

total_debt = debt_amount + accrued_fee

health_bps = collateral_value_usd * 10000 / total_debt

// Safe: health_bps >= min_collateral_ratio_bps
// Liquidatable: health_bps < liquidation_threshold_bps
```

### Example at Various SOL Prices

Assume 2 SOL collateral, 100 CUSD debt, min ratio 150%, liquidation threshold 130%:

| SOL Price | Collateral Value | Health | Status |
|-----------|-----------------|--------|--------|
| $150 | $300 | 300% | Safe (3x) |
| $100 | $200 | 200% | Safe (2x) |
| $80 | $160 | 160% | Safe (above 150%) |
| $75 | $150 | 150% | At minimum (cannot borrow more) |
| $70 | $140 | 140% | Undercollateralized (between 130-150%, cannot withdraw) |
| $65 | $130 | 130% | At liquidation threshold |
| $60 | $120 | 120% | Liquidatable |

---

## Instructions

### `initialize_credit_config`

Sets up the credit module for a stablecoin.

```typescript
const [creditConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("credit_config"), stablecoinConfigPda.toBuffer()],
  SSS_11_PROGRAM_ID
);

await sss11Program.methods.initializeCreditConfig({
  collateralMint: wsolMint,        // Wrapped SOL
  oracleConfig: solUsdOraclePda,
  minCollateralRatioBps: 15000,    // 150%
  liquidationThresholdBps: 13000, // 130%
  liquidationPenaltyBps: 500,     // 5%
  stabilityFeeBps: 200,           // 2% APY
}).accounts({
  creditConfig: creditConfigPda,
  stablecoinConfig: stablecoinConfigPda,
  creditVault: creditVaultAtaPda,
  collateralMint: wsolMint,
  authority: authority.publicKey,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
}).rpc();
```

### `open_position`

Creates a `CreditPosition` PDA and deposits initial collateral.

```typescript
const [positionPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("credit_position"), creditConfigPda.toBuffer(), borrower.publicKey.toBuffer()],
  SSS_11_PROGRAM_ID
);

await sss11Program.methods.openPosition(
  new BN(2 * 10**9), // 2 wSOL (9 decimals)
  new BN(100_000_000) // Borrow 100 CUSD (6 decimals)
).accounts({
  creditConfig: creditConfigPda,
  creditPosition: positionPda,
  creditVault: creditVaultAtaPda,
  borrowerCollateralAccount: borrowerWsolAta,
  borrowerStablecoinAccount: borrowerCusdAta,
  oracleConfig: solUsdOraclePda,
  stablecoinConfig: stablecoinConfigPda,
  minterQuota: creditProgramMinterQuotaPda,
  roleAccount: creditProgramMinterRolePda,
  mint: cusdMint,
  borrower: borrower.publicKey,
  clock: SYSVAR_CLOCK_PUBKEY,
  tokenProgram: TOKEN_2022_PROGRAM_ID,
  systemProgram: SystemProgram.programId,
  sssProgram: SSS_PROGRAM_ID,
}).rpc();
```

**Validation**:
1. Read oracle price
2. Check `collateral_value / borrow_amount >= min_collateral_ratio_bps / 10000`
3. Transfer collateral from borrower to vault
4. CPI: SSS `mint_tokens` → mint stablecoin to borrower
5. Initialize CreditPosition PDA
6. Update CreditConfig totals

### `deposit_collateral`

Adds more collateral to an existing position (improves health).

```typescript
await sss11Program.methods.depositCollateral(new BN(1 * 10**9)) // Add 1 wSOL
  .accounts({
    creditConfig: creditConfigPda,
    creditPosition: positionPda,
    creditVault: creditVaultAtaPda,
    borrowerCollateralAccount: borrowerWsolAta,
    borrower: borrower.publicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

### `withdraw_collateral`

Withdraws collateral from the position, subject to health factor check.

```typescript
await sss11Program.methods.withdrawCollateral(new BN(5 * 10**8)) // Withdraw 0.5 wSOL
  .accounts({ /* ... */ })
  .rpc();
// Fails with CollateralRatioTooLow if health would drop below min_ratio
```

### `borrow_more`

Mints additional stablecoin against existing collateral.

```typescript
await sss11Program.methods.borrowMore(new BN(50_000_000)) // Borrow 50 more CUSD
  .accounts({ /* ... */ })
  .rpc();
```

### `repay`

Repays stablecoin debt. Burns the repaid tokens.

```typescript
await sss11Program.methods.repay(new BN(100_000_000)) // Repay 100 CUSD + accrued fee
  .accounts({
    creditConfig: creditConfigPda,
    creditPosition: positionPda,
    borrowerStablecoinAccount: borrowerCusdAta,
    stablecoinConfig: stablecoinConfigPda,
    mint: cusdMint,
    borrower: borrower.publicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    sssProgram: SSS_PROGRAM_ID,
  })
  .rpc();
// Burns debt_amount from borrower's account
// Clears accrued_fee
```

### `close_position`

Repays all remaining debt and returns all collateral. Closes the CreditPosition PDA.

```typescript
await sss11Program.methods.closePosition()
  .accounts({ /* ... */ })
  .rpc();
// Transfers all collateral back to borrower
// Burns all remaining debt + accrued fees
// Closes position PDA (rent returned to borrower)
```

### `liquidate`

Permissionless. Anyone can call when `health < liquidation_threshold_bps`.

```typescript
await sss11Program.methods.liquidate(positionOwner)
  .accounts({
    creditConfig: creditConfigPda,
    creditPosition: positionPda,
    creditVault: creditVaultAtaPda,
    liquidatorStablecoinAccount: liquidatorCusdAta,
    liquidatorCollateralAccount: liquidatorWsolAta,
    oracleConfig: solUsdOraclePda,
    stablecoinConfig: stablecoinConfigPda,
    mint: cusdMint,
    liquidator: liquidator.publicKey,
    clock: SYSVAR_CLOCK_PUBKEY,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    sssProgram: SSS_PROGRAM_ID,
  })
  .rpc();
```

**Liquidation mechanics**:
```
total_debt = debt_amount + accrued_fee
collateral_seized = total_debt_usd_value / oracle_price * (1 + liquidation_penalty_bps / 10000)
                    * collateral_token_decimals

Steps:
1. Verify position is liquidatable (health < threshold)
2. Transfer collateral_seized from vault to liquidator
3. Transfer remaining collateral (if any) to borrower
4. Burn total_debt stablecoins from liquidator's account
5. Close the position PDA
```

**Example** (SOL at $65, 2 SOL collateral, 100 CUSD debt, 5% penalty):
```
total_debt_usd = 100 CUSD = $100
collateral_needed_usd = $100 * 1.05 = $105 (with 5% bonus to liquidator)
collateral_seized_sol = $105 / $65 = 1.615 SOL
returned_to_borrower = 2 SOL - 1.615 SOL = 0.385 SOL
liquidator net gain: $105 of SOL for $100 of CUSD spent = $5 profit
```

### `accrue_stability_fee`

Permissionless crank that accrues the stability fee for a position.

```typescript
await sss11Program.methods.accrueStabilityFee()
  .accounts({
    creditConfig: creditConfigPda,
    creditPosition: positionPda,
    borrower: borrowerPublicKey,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
```

---

## Oracle Integration

The credit module requires a fresh oracle price for most operations. The oracle must be cranked if stale.

```typescript
async function ensureFreshOracle(oracleConfigPda: PublicKey): Promise<void> {
  const oracle = await oracleProgram.account.oracleConfig.fetch(oracleConfigPda);
  const now = Math.floor(Date.now() / 1000);

  if (now - oracle.lastUpdated.toNumber() > oracle.stalenessThreshold.toNumber()) {
    console.log("Oracle stale, refreshing...");
    await oracleProgram.methods.refreshPrice()
      .accounts({
        oracleConfig: oracleConfigPda,
        aggregator: oracle.aggregator,
        clock: SYSVAR_CLOCK_PUBKEY,
      })
      .rpc();
  }
}
```

---

## TypeScript SDK Examples

### Check Position Health

```typescript
async function checkPositionHealth(
  sss11Program: Program,
  oracleProgram: Program,
  creditConfigPda: PublicKey,
  borrowerPubkey: PublicKey
): Promise<{
  health: number;
  collateralValue: number;
  totalDebt: number;
  status: "safe" | "at_risk" | "liquidatable";
}> {
  const [positionPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("credit_position"), creditConfigPda.toBuffer(), borrowerPubkey.toBuffer()],
    sss11Program.programId
  );

  const [config, position, oracle] = await Promise.all([
    sss11Program.account.creditConfig.fetch(creditConfigPda),
    sss11Program.account.creditPosition.fetch(positionPda),
    oracleProgram.account.oracleConfig.fetch(/* oracle pda */),
  ]);

  const priceUsd = oracle.price.toNumber() / Math.pow(10, oracle.priceDecimals);
  const collateralDecimals = 9; // wSOL has 9 decimals
  const collateralUsd = (position.collateralAmount.toNumber() / Math.pow(10, collateralDecimals)) * priceUsd;

  const stableDecimals = 6;
  const totalDebt = (position.debtAmount.add(position.accruedFee).toNumber()) / Math.pow(10, stableDecimals);

  const healthBps = totalDebt === 0 ? Infinity : (collateralUsd / totalDebt) * 10000;

  return {
    health: healthBps,
    collateralValue: collateralUsd,
    totalDebt,
    status:
      healthBps < config.liquidationThresholdBps ? "liquidatable"
      : healthBps < config.minCollateralRatioBps ? "at_risk"
      : "safe",
  };
}
```

### Find All Liquidatable Positions

```typescript
async function findLiquidatablePositions(
  connection: Connection,
  sss11Program: Program,
  creditConfigPda: PublicKey,
  oraclePrice: number
): Promise<PublicKey[]> {
  // Fetch all CreditPosition accounts for this config
  const positions = await sss11Program.account.creditPosition.all([
    {
      memcmp: {
        offset: 8, // After discriminator
        bytes: creditConfigPda.toBase58(),
      },
    },
  ]);

  const liquidatable: PublicKey[] = [];

  for (const { publicKey, account } of positions) {
    const collateralUsd = (account.collateralAmount.toNumber() / 1e9) * oraclePrice;
    const totalDebt = account.debtAmount.add(account.accruedFee).toNumber() / 1e6;

    if (totalDebt === 0) continue;

    const healthBps = (collateralUsd / totalDebt) * 10000;
    if (healthBps < 13000) { // Below liquidation threshold
      liquidatable.push(publicKey);
    }
  }

  return liquidatable;
}
```

---

## Risk Parameters (Recommended Defaults)

| Parameter | Conservative | Standard | Aggressive |
|-----------|-------------|----------|------------|
| `min_collateral_ratio_bps` | 20000 (200%) | 15000 (150%) | 12000 (120%) |
| `liquidation_threshold_bps` | 17500 (175%) | 13000 (130%) | 11000 (110%) |
| `liquidation_penalty_bps` | 1000 (10%) | 500 (5%) | 300 (3%) |
| `stability_fee_bps` | 500 (5%) | 200 (2%) | 50 (0.5%) |

**Recommendation**: Start conservative and relax parameters as the system accumulates liquidation history and oracle reliability data.

---

## Comparison to MakerDAO/DAI

| Aspect | MakerDAO DAI | SSS-11 |
|--------|--------------|--------|
| Position type | Maker Vault (CDP) | `CreditPosition` PDA |
| Collateral | Multi-collateral | Single collateral per `CreditConfig` |
| Multi-collateral | DAI uses multiple vault types | Use SSS-8 for multi-collateral |
| Governance | MKR token voting | SSS master authority + Squads |
| Stability fee | Global DSR + vault-specific SF | `stability_fee_bps` per CreditConfig |
| Liquidation | Keeper bots, Clip.sol auction | Permissionless `liquidate` instruction |
| Oracle | Chainlink + Maker oracle | Switchboard V2 via SSS Oracle program |
| Peg mechanism | PSM (Peg Stability Module) | Arbitrage + overcollateralization |
| Minimum debt | Dust limit (e.g., 2,000 DAI) | Configurable (`min_debt_amount`) |
| Price delay | Oracle Security Module (1hr delay) | `staleness_threshold` in Oracle program |

---

## Events

The SSS-11 program emits events for all state transitions:

```rust
#[event] pub struct CreditConfigInitialized { pub credit_config: Pubkey, pub collateral_mint: Pubkey, pub authority: Pubkey }
#[event] pub struct PositionOpened { pub position: Pubkey, pub borrower: Pubkey, pub collateral: u64, pub debt: u64 }
#[event] pub struct CollateralDeposited { pub position: Pubkey, pub borrower: Pubkey, pub amount: u64 }
#[event] pub struct CollateralWithdrawn { pub position: Pubkey, pub borrower: Pubkey, pub amount: u64 }
#[event] pub struct DebtRepaid { pub position: Pubkey, pub borrower: Pubkey, pub amount: u64, pub fee_paid: u64 }
#[event] pub struct PositionLiquidated { pub position: Pubkey, pub borrower: Pubkey, pub liquidator: Pubkey, pub collateral_seized: u64, pub debt_repaid: u64 }
#[event] pub struct StabilityFeeAccrued { pub position: Pubkey, pub borrower: Pubkey, pub fee_accrued: u64, pub total_accrued_fee: u64 }
```
