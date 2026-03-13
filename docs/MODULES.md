# Module System

SSS uses a composable module architecture where the core SSS program coordinates with optional extension programs through `remaining_accounts`. This document explains how the system works, how to attach modules, how modules interoperate, and how to build a custom module.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                  SSS Core Program                │
│                                                 │
│  mint_tokens() {                                │
│    1. Check MinterRole PDA                      │
│    2. Check MinterQuota PDA                     │
│    3. Check paused flag                         │
│    4. Read remaining_accounts → module PDAs     │
│    5. Validate module constraints               │
│    6. CPI: Token-2022 mint_to                   │
│    7. Emit TokensMinted                         │
│  }                                              │
└─────────────────────────────────────────────────┘
           │               │               │
           ▼               ▼               ▼
     ┌──────────┐   ┌──────────────┐  ┌──────────────┐
     │ SSS-Caps │   │ SSS-Allowlist│  │ SSS-Timelock │
     │ CapsConfig│  │AllowlistConfig│  │TimelockConfig│
     │  PDA      │  │    PDA       │  │    PDA       │
     └──────────┘   └──────────────┘  └──────────────┘
```

The key insight: **modules do not CPI into the SSS program**. Instead, the SSS program reads module PDAs from `remaining_accounts` and validates constraints locally. This means:

1. No additional compute budget is needed for CPI overhead between modules
2. Modules can be added to a stablecoin without upgrading the SSS program
3. The SSS program is the single source of truth for all state mutations
4. Module PDAs are owned by their respective programs — SSS reads but never writes them

---

## What `remaining_accounts` Composability Means

In Anchor, every instruction has a fixed set of accounts declared in the `#[derive(Accounts)]` struct. The `remaining_accounts` field is a slice of additional `AccountInfo` entries that are not statically typed — they are passed by position and the program interprets them dynamically.

SSS uses this pattern to optionally read module configuration PDAs during `mint_tokens`:

```rust
// In mint_tokens handler (conceptual):
for account in ctx.remaining_accounts.iter() {
    // Try to deserialize as CapsConfig
    if let Ok(caps) = CapsConfig::try_deserialize(&mut &account.data.borrow()[..]) {
        // Verify this CapsConfig belongs to our stablecoin
        require!(caps.stablecoin_config == config.key(), InvalidModule);

        // Enforce global cap
        if caps.global_cap > 0 {
            require!(
                config.total_minted.checked_add(amount).unwrap() <= caps.global_cap,
                SupplyCapExceeded
            );
        }

        // Enforce per-minter cap
        if caps.per_minter_cap > 0 {
            require!(
                minter_quota.minted.checked_add(amount).unwrap() <= caps.per_minter_cap,
                QuotaExceeded
            );
        }
    }
}
```

**Security model**: The SSS program verifies that each module PDA's `stablecoin_config` field matches the current stablecoin. This prevents spoofing — you cannot pass a caps config for a different stablecoin.

**No module = no constraint**: If a module PDA is not passed in `remaining_accounts`, its constraint is simply not enforced. This is the correct behavior — a stablecoin without the caps module attached has no additional supply cap beyond the SSS-native `supply_cap` field.

---

## Available Modules

### SSS-Caps

Adds external supply cap management with separate authority control.

| Feature | Description |
|---------|-------------|
| `global_cap` | Maximum total supply across all minters |
| `per_minter_cap` | Maximum cumulative amount any single minter may mint |
| Separate authority | The caps authority can be a different keypair than the master authority |
| Dynamic updates | Caps can be raised or lowered at any time by the caps authority |

Use case: A regulated issuer wants the compliance team to control supply limits independently of the treasury team that manages mint roles.

### SSS-Allowlist

Adds allowlist-only minting mode.

| Feature | Description |
|---------|-------------|
| `mode` | `Open` (anyone can receive) or `AllowlistOnly` (only listed addresses) |
| Per-address entries | `AllowlistEntry` PDAs per approved address |
| Separate authority | The allowlist authority manages the list independently |

Use case: A private stablecoin issuer that only distributes to KYC-verified institutional clients.

### SSS-Timelock

Adds mandatory delay to governance operations.

| Feature | Description |
|---------|-------------|
| `delay_seconds` | Minimum time between scheduling and execution |
| `PendingOp` PDAs | Each queued operation has its own PDA with status and scheduled_at |
| Cancellation | The authority can cancel a pending op before execution |

Use case: A DAO-governed stablecoin where supply cap changes must be announced 48 hours in advance.

---

## Attaching a Module to a Stablecoin

### Step 1: Deploy the Module Program

```bash
anchor build
anchor deploy --program-name sss-caps
# Note the program ID
```

### Step 2: Initialize the Module Config

```typescript
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

const capsProgram = new Program(capsIdl, CAPS_PROGRAM_ID, provider);

// Derive the CapsConfig PDA
const [capsConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("caps_config"), stablecoinConfigPda.toBuffer()],
  CAPS_PROGRAM_ID
);

await capsProgram.methods
  .initializeCapsConfig(
    new anchor.BN(100_000_000_000_000), // global_cap: 100M tokens with 6 decimals
    new anchor.BN(10_000_000_000_000)   // per_minter_cap: 10M tokens
  )
  .accounts({
    capsConfig: capsConfigPda,
    stablecoinConfig: stablecoinConfigPda,
    authority: wallet.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Step 3: Pass the Module PDA in `remaining_accounts`

```typescript
const sssProgram = new Program(sssIdl, SSS_PROGRAM_ID, provider);

await sssProgram.methods
  .mintTokens(new anchor.BN(1_000_000)) // 1 token (6 decimals)
  .accounts({
    config: stablecoinConfigPda,
    mint: mintAddress,
    minterQuota: minterQuotaPda,
    roleAccount: minterRolePda,
    recipientTokenAccount: recipientAta,
    minter: wallet.publicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .remainingAccounts([
    // Attach the CapsConfig module
    {
      pubkey: capsConfigPda,
      isSigner: false,
      isWritable: false,  // Module PDAs are always read-only
    },
  ])
  .rpc();
```

### Step 4: Verify Module Enforcement

```typescript
// If the caps module is attached and the mint would exceed global_cap,
// the instruction will fail with SupplyCapExceeded (6019).
// Verify the caps are being enforced:

const capsConfig = await capsProgram.account.capsConfig.fetch(capsConfigPda);
console.log("Global cap:", capsConfig.globalCap.toString());
console.log("Per-minter cap:", capsConfig.perMinterCap.toString());

const sssConfig = await sssProgram.account.stablecoinConfig.fetch(stablecoinConfigPda);
console.log("Total minted:", sssConfig.totalMinted.toString());
console.log("Remaining:", capsConfig.globalCap.sub(sssConfig.totalMinted).toString());
```

---

## PDA Lookup Pattern

The SSS program uses discriminator-based detection to identify which module a `remaining_account` represents. Each Anchor account type has a unique 8-byte discriminator (SHA256 prefix of `"account:<TypeName>"`).

```rust
// How SSS identifies module PDAs from remaining_accounts
fn detect_module(account: &AccountInfo) -> Option<ModuleType> {
    let data = account.data.borrow();
    if data.len() < 8 {
        return None;
    }
    let disc = &data[..8];

    // Compare against known module discriminators
    if disc == CapsConfig::DISCRIMINATOR {
        return Some(ModuleType::Caps);
    }
    if disc == AllowlistConfig::DISCRIMINATOR {
        return Some(ModuleType::Allowlist);
    }
    // etc.
    None
}
```

The SSS program can handle multiple modules simultaneously — pass both a `CapsConfig` and an `AllowlistConfig` in `remaining_accounts` and both will be enforced in sequence.

---

## Building a Custom Module

A custom module is an Anchor program that:

1. Manages a config PDA with seed `["<module_name>_config", stablecoin_config]`
2. Stores a `stablecoin_config: Pubkey` field linking it to the stablecoin
3. Exposes admin instructions for managing the config
4. Relies on the SSS program to read and enforce its constraints during `mint_tokens`

### Example: Custom Whitelist Module

```rust
use anchor_lang::prelude::*;

declare_id!("YourCustomModuleProgramId111111111111111111");

#[program]
pub mod my_whitelist {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, authority: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.whitelist_config;
        config.stablecoin_config = ctx.accounts.stablecoin_config.key();
        config.authority = authority;
        config.bump = ctx.bumps.whitelist_config;
        Ok(())
    }

    pub fn add_address(ctx: Context<AddAddress>, label: String) -> Result<()> {
        // Create AllowlistEntry PDA
        Ok(())
    }
}

#[account]
pub struct WhitelistConfig {
    pub stablecoin_config: Pubkey,  // REQUIRED: link to SSS stablecoin
    pub authority: Pubkey,
    pub bump: u8,
}

impl WhitelistConfig {
    pub const DISCRIMINATOR: &'static [u8; 8] = &[/* sha256 prefix */];
}
```

The SSS program maintainer would then add discriminator detection for your module's config account in the `mint_tokens` handler. This upgrade path requires a program upgrade of the SSS program.

**Alternative approach (no SSS upgrade required)**: Build a wrapper program that performs validation and then CPIs into SSS. This is a more flexible but higher-cost approach.

---

## Integration Guide with TypeScript Examples

### Helper: Build `remainingAccounts` from active modules

```typescript
import { PublicKey } from "@solana/web3.js";

interface ModuleConfig {
  caps?: PublicKey;
  allowlist?: PublicKey;
  timelock?: PublicKey;
}

function buildRemainingAccounts(modules: ModuleConfig) {
  const accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];

  if (modules.caps) {
    accounts.push({ pubkey: modules.caps, isSigner: false, isWritable: false });
  }
  if (modules.allowlist) {
    accounts.push({ pubkey: modules.allowlist, isSigner: false, isWritable: false });
  }
  if (modules.timelock) {
    accounts.push({ pubkey: modules.timelock, isSigner: false, isWritable: false });
  }
  return accounts;
}

// Usage
const mintTx = await sssProgram.methods
  .mintTokens(amount)
  .accounts({ /* fixed accounts */ })
  .remainingAccounts(buildRemainingAccounts({
    caps: capsConfigPda,
    allowlist: allowlistConfigPda,
  }))
  .rpc();
```

### Helper: Derive all module PDAs for a stablecoin

```typescript
function deriveModulePDAs(
  stablecoinConfig: PublicKey,
  programIds: {
    caps: PublicKey;
    allowlist: PublicKey;
    timelock: PublicKey;
  }
) {
  return {
    caps: PublicKey.findProgramAddressSync(
      [Buffer.from("caps_config"), stablecoinConfig.toBuffer()],
      programIds.caps
    )[0],
    allowlist: PublicKey.findProgramAddressSync(
      [Buffer.from("allowlist_config"), stablecoinConfig.toBuffer()],
      programIds.allowlist
    )[0],
    timelock: PublicKey.findProgramAddressSync(
      [Buffer.from("timelock_config"), stablecoinConfig.toBuffer()],
      programIds.timelock
    )[0],
  };
}
```

### Checking Module Status

```typescript
// Check if a module is initialized for a stablecoin
async function isModuleActive(
  connection: Connection,
  modulePda: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(modulePda);
  return info !== null && info.data.length > 0;
}

// Read caps config state
async function getCapsState(capsProgram: Program, capsConfigPda: PublicKey) {
  try {
    const config = await capsProgram.account.capsConfig.fetch(capsConfigPda);
    return {
      active: true,
      globalCap: config.globalCap.toString(),
      perMinterCap: config.perMinterCap.toString(),
    };
  } catch {
    return { active: false };
  }
}
```

---

## Comparison to OpenZeppelin's Modular Contracts

| Aspect | SSS Modules | OpenZeppelin (ERC-20) |
|--------|-------------|----------------------|
| Composition pattern | `remaining_accounts` passed per-instruction | Inheritance / mixins at compile time |
| Upgrade path | Add new modules without upgrading core | Requires new contract deployment |
| State separation | Modules own their own PDAs | All state in one contract storage |
| Inter-module calls | SSS reads module state; no CPI needed | Functions call inherited methods |
| Authority model | Each module can have its own authority | Single contract owner / access control |
| Gas/Compute cost | Module reads add ~5k CU per module | Function calls within one EVM call |
| Composability scope | Only SSS-aware modules can integrate | Any contract can inherit from OZ |
| Auditability | Each module is an independently audited program | Inherited code is part of the same audit |
| Deployment | Separate on-chain programs | Libraries linked at compile time |

The key philosophical difference: OpenZeppelin composability happens at the Solidity source level (inheritance), while SSS composability happens at the runtime level (remaining_accounts). This means SSS modules can be added to an existing stablecoin post-deployment without any upgrade to the stablecoin config or mint account.

---

## Module Security Properties

1. **Isolation**: Each module's state is stored in its own program's PDAs. A bug in the caps module cannot corrupt the core SSS config.

2. **Verification**: The SSS program always verifies `module_config.stablecoin_config == current_config.key()` before trusting module data. An attacker cannot substitute a module config from a different stablecoin.

3. **Read-only**: Module PDAs are always passed as non-writable in `remaining_accounts`. The SSS program reads but never writes them.

4. **Optional enforcement**: Modules are opt-in per transaction. The caller decides whether to include a module PDA. This enables the SSS program to be used for operations that bypass module constraints (e.g., an emergency mint by the master authority that bypasses the caps module).

5. **No trusted setup**: Module programs are independently deployed and have no privileged relationship with the SSS program at the code level. The SSS program identifies them by discriminator bytes.

---

## Module Governance Patterns

### Multi-authority module setup

```typescript
// Caps module controlled by risk team, allowlist by compliance team
await capsProgram.methods.initializeCapsConfig(globalCap, perMinterCap)
  .accounts({ authority: riskTeamPubkey })
  .rpc();

await allowlistProgram.methods.initializeAllowlistConfig()
  .accounts({ authority: complianceTeamPubkey })
  .rpc();
```

### Module parameter changes via timelock

```typescript
// Schedule a cap increase through the timelock module
await timelockProgram.methods
  .scheduleCapsUpdate(newGlobalCap, newPerMinterCap)
  .accounts({ timelockConfig: timelockConfigPda })
  .rpc();

// After delay_seconds have elapsed:
await timelockProgram.methods
  .executeOp(opId)
  .accounts({ pendingOp: pendingOpPda })
  .rpc();
// This CPI's into the caps program to apply the new caps
```
