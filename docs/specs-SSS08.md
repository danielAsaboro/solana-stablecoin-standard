# SSS-8: Multi-Collateral Stablecoin

| Field | Value |
|-------|-------|
| Standard | SSS-8 |
| Title | Multi-Collateral Basket Stablecoin |
| Status | Draft |
| Requires | SSS-7, SSS Oracle Program |
| Use Case | Stablecoin backed by a basket of assets (USDC + SOL + BTC), analogous to DAI's multi-collateral system |

---

## Abstract

SSS-8 extends SSS-7's single-collateral (SOL) model to support multiple collateral types simultaneously. Each collateral type has its own vault, oracle feed, weight in the basket, and independent collateral ratio. The system maintains solvency by tracking a portfolio-weighted collateral ratio across all deposited assets.

---

## Use Cases

1. **Index stablecoin**: Backed by SOL (40%), BTC (40%), ETH (20%). More stable than any single collateral.

2. **Regulated reserve stablecoin**: Backed by USDC (60%), short-term Treasury tokens (40%). Fully on-chain reserve backing.

3. **DeFi basket**: Backed by JitoSOL, mSOL, bSOL — liquid staking tokens with oracle-attested prices.

---

## Architecture

```
MultiCollateralConfig PDA
["multi_collateral_config", stablecoin_config]
  ├── collateral_types: Vec<CollateralType>
  │     ├── token_mint: Pubkey (SOL, USDC, wBTC, etc.)
  │     ├── oracle_config: Pubkey (SSS oracle for this asset)
  │     ├── weight_bps: u16 (target weight, sums to 10000)
  │     ├── max_collateral_bps: u16 (max % of basket from this asset)
  │     └── min_collateral_ratio_bps: u32 (per-asset minimum)
  └── global_liquidation_threshold_bps: u32

CollateralVault PDAs (one per collateral type)
["collateral_vault", multi_collateral_config, token_mint]
  ├── token_mint: Pubkey
  ├── vault_token_account: Pubkey
  ├── total_deposited: u64
  └── oracle_config: Pubkey

MultiCollateralPosition PDA (per user)
["multi_position", multi_collateral_config, owner]
  ├── owner: Pubkey
  ├── deposits: Vec<AssetDeposit>
  │     ├── token_mint: Pubkey
  │     └── amount: u64
  ├── minted_stablecoin: u64
  └── last_fee_accrual: i64
```

---

## Portfolio Collateral Ratio

### Definition

The portfolio collateral ratio is the sum of each asset's contribution:

```
portfolio_health_bps = Σ (asset_value_usd * 10000) / total_debt_usd

Where:
  asset_value_usd = amount_deposited * oracle_price / asset_decimals
```

In practice:

```rust
pub fn calculate_portfolio_health(
    deposits: &[AssetDeposit],
    oracle_prices: &[u64],         // One price per deposit, in USD with stablecoin decimals
    minted_stablecoin: u64,
) -> u128 {
    let total_collateral_value: u128 = deposits
        .iter()
        .zip(oracle_prices.iter())
        .map(|(dep, &price)| {
            (dep.amount as u128)
                .saturating_mul(price as u128)
                // normalize to stablecoin decimal precision
        })
        .sum();

    if minted_stablecoin == 0 {
        return u128::MAX;
    }

    total_collateral_value
        .saturating_mul(10_000)
        / (minted_stablecoin as u128)
}
```

### Example

| Asset | Deposited | Price | USD Value |
|-------|-----------|-------|-----------|
| SOL | 2 SOL | $100 | $200 |
| USDC | 100 USDC | $1.00 | $100 |
| wBTC | 0.001 BTC | $50,000 | $50 |
| **Total** | | | **$350** |

If the user minted 200 CUSD:
```
portfolio_health_bps = 350 / 200 * 10000 = 17,500 bps (175%)
```

This is above the 150% minimum — position is safe.

---

## CollateralVault PDA

Each accepted collateral type has a vault that holds the deposited tokens:

```rust
#[account]
pub struct CollateralVault {
    pub multi_collateral_config: Pubkey,
    pub token_mint: Pubkey,
    pub vault_token_account: Pubkey, // Token account held by this PDA
    pub oracle_config: Pubkey,       // SSS Oracle for this asset
    pub weight_bps: u16,             // Target portfolio weight
    pub max_allocation_bps: u16,     // Max % of total collateral
    pub total_deposited: u64,        // Running total in base units
    pub bump: u8,
}
```

---

## Instructions

### `initialize_multi_collateral_config`

Sets up the root config with global risk parameters.

### `add_collateral_type`

Adds a new accepted collateral asset:

```typescript
await sss8Program.methods.addCollateralType({
  tokenMint: wbtcMint,
  oracleConfig: wbtcOraclePda,
  weightBps: 4000,         // Target 40% of basket
  maxAllocationBps: 6000,  // Never more than 60% of basket
}).accounts({
  multiCollateralConfig: configPda,
  collateralVault: wbtcVaultPda,
  vaultTokenAccount: wbtcVaultAtaPda,
  authority: authority.publicKey,
}).rpc();
```

### `deposit_collateral`

Deposits one or more collateral types into the user's position:

```typescript
await sss8Program.methods.depositCollateral([
  { tokenMint: solMint, amount: new BN(2 * LAMPORTS_PER_SOL) },
  { tokenMint: usdcMint, amount: new BN(100_000_000) }, // 100 USDC
]).accounts({
  multiPosition: userPositionPda,
  multiCollateralConfig: configPda,
  // remaining_accounts: vault PDAs and user ATAs for each asset
}).rpc();
```

### `borrow`

Mints stablecoin against the deposited collateral, subject to portfolio health check.

```typescript
// After depositing $350 collateral, borrow up to 350/1.5 = $233 CUSD
await sss8Program.methods.borrow(new BN(200_000_000)) // 200 CUSD
  .accounts({ /* ... */ })
  .rpc();
```

### `liquidate`

Liquidates an undercollateralized position. Liquidators can choose which collateral to receive:

```typescript
// Liquidate, receiving SOL collateral as the reward
await sss8Program.methods.liquidate(
  positionOwner,
  wantedCollateralMint, // SOL preferred
  debtAmount            // amount to repay
).accounts({ /* ... */ }).rpc();
```

**Liquidation order**: When a position is unhealthy, the protocol liquidates the least stable collateral first (by individual asset collateral ratio), preserving the most stable assets (e.g., USDC).

---

## Weighting and Rebalancing

### Target Weight Enforcement

The `weight_bps` and `max_allocation_bps` parameters enforce basket composition:

```
If SOL's share of total collateral value > max_allocation_bps:
  → New SOL deposits are rejected
  → Protocol may incentivize SOL withdrawals and USDC deposits
```

### Portfolio Rebalancing Incentives

Rather than forced rebalancing, SSS-8 uses fee incentives:

- Deposits that move the portfolio toward target weights receive a **discount** on stability fees
- Deposits that increase concentration above `max_allocation_bps` receive a **surcharge**

This creates market-based rebalancing without forced liquidations.

---

## Oracle Requirements

Each collateral type requires an SSS Oracle `OracleConfig` PDA linked to a Switchboard V2 feed:

| Collateral | Recommended Feed |
|------------|-----------------|
| SOL | Switchboard SOL/USD |
| USDC | Hardcoded $1.00 (no oracle needed) |
| wBTC | Switchboard BTC/USD |
| JitoSOL | Switchboard jitoSOL/SOL × SOL/USD |
| mSOL | Switchboard mSOL/SOL × SOL/USD |

For stable assets (USDC, USDT), the oracle can be a manual-override oracle set to exactly 1.000000 with a very long staleness threshold.

---

## Comparison to DAI Multi-Collateral

| Aspect | MakerDAO Multi-Collateral DAI | SSS-8 |
|--------|------------------------------|-------|
| Collateral types | ETH, WBTC, USDC, LP tokens, etc. | Any SPL Token with Switchboard feed |
| Vault model | Individual Vault per collateral type | Unified position with multiple deposits |
| Weight enforcement | Per-vault debt ceilings | Portfolio-level weight + max_allocation_bps |
| Oracle | Chainlink + MakerDAO oracle | Switchboard V2 via SSS Oracle program |
| Liquidation | Keeper bots, auction | Permissionless `liquidate` instruction |
| Governance | MKR voting | SSS master authority + Squads multisig |
| Stability fee | Per-collateral MKR burn | Per-protocol `stability_fee_bps` |

---

## Risk Management

### Per-Asset Limits

Each collateral type has independent limits:

```
global_health_bps >= global_liquidation_threshold_bps
AND
per_asset_value / total_collateral_value <= max_allocation_bps
```

Both conditions must hold. A position can be liquidated if either fails.

### Concentration Risk

If one collateral type's price crashes significantly:
1. Its contribution to portfolio health drops
2. Overall health may fall below the threshold
3. Liquidators receive that asset at a discount (liquidation penalty)
4. Protocol burns the repaid stablecoins

### Circuit Breakers

The authority can set `max_allocation_bps = 0` for an asset to halt new deposits of that type without affecting existing positions. This is useful during a market stress event.

---

## Events

```rust
#[event]
pub struct MultiCollateralConfigInitialized {
    pub config: Pubkey,
    pub stablecoin_config: Pubkey,
    pub authority: Pubkey,
    pub global_liquidation_threshold_bps: u32,
}

#[event]
pub struct CollateralTypeAdded {
    pub config: Pubkey,
    pub token_mint: Pubkey,
    pub oracle_config: Pubkey,
    pub weight_bps: u16,
    pub max_allocation_bps: u16,
}

#[event]
pub struct MultiPositionOpened {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub minted_stablecoin: u64,
}

#[event]
pub struct CollateralDeposited {
    pub position: Pubkey,
    pub token_mint: Pubkey,
    pub amount: u64,
    pub new_portfolio_health_bps: u128,
}

#[event]
pub struct PositionLiquidated {
    pub position: Pubkey,
    pub owner: Pubkey,
    pub liquidator: Pubkey,
    pub collateral_mint: Pubkey,
    pub collateral_seized: u64,
    pub debt_repaid: u64,
}
```

---

## Security Considerations

### Oracle Manipulation Risk

SSS-8 depends on multiple oracle feeds. Each additional collateral type introduces an additional oracle risk vector. An attacker who can manipulate the `wBTC/USD` feed could over-borrow against wBTC collateral. Mitigations:

1. Set `max_allocation_bps` conservatively per asset
2. Use Switchboard's decentralized oracles with multiple data sources
3. Implement oracle circuit breakers (pause new borrowing if price moves >10% in one slot)
4. Require a minimum staleness threshold per collateral type

### Collateral Correlation Risk

If all collateral assets are highly correlated (e.g., SOL, mSOL, JitoSOL), a single market event can crash all portfolio values simultaneously. SSS-8 addresses this by supporting uncorrelated assets (SOL + USDC + wBTC), but the risk parameters should reflect actual correlation data.

### Flash Loan Attack Surface

Permissionless liquidation is vulnerable to flash loan amplification. An attacker could:
1. Borrow USDC via flash loan
2. Crash the SOL price by selling
3. Liquidate many positions in the same block
4. Profit from the liquidation bonuses

Mitigation: Use time-weighted average prices (TWAP) rather than spot prices for liquidation decisions. SSS's Oracle program can be extended to compute a TWAP from historical price observations.
