# SDK Reference

> Complete API reference for `@stbr/sss-core-sdk` and `@stbr/sss-compliance-sdk`.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Presets](#presets)
- [Creating a Stablecoin](#creating-a-stablecoin)
- [Loading an Existing Stablecoin](#loading-an-existing-stablecoin)
- [Operations (Params API)](#operations-params-api)
- [Fluent Builder API](#fluent-builder-api)
- [Batch Operations](#batch-operations)
- [Event Parsing](#event-parsing)
- [Retry and Error Recovery](#retry-and-error-recovery)
- [Transaction Simulation](#transaction-simulation)
- [Read Methods](#read-methods)
- [PDA Helpers](#pda-helpers)
- [Compliance SDK](#compliance-sdk-stbrsss-compliance-sdk)
- [End-to-End Workflows](#end-to-end-workflows)

---

## Installation

```bash
yarn add @stbr/sss-core-sdk @stbr/sss-compliance-sdk
```

Both packages depend on `@coral-xyz/anchor`, `@solana/web3.js`, and `@solana/spl-token`.

---

## Quick Start

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { SolanaStablecoin, Presets, RoleType } from "@stbr/sss-core-sdk";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import BN from "bn.js";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const authority = Keypair.generate();

// 1. Create an SSS-1 stablecoin
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    ...Presets.SSS_1,
    name: "My USD",
    symbol: "MUSD",
    uri: "https://example.com/metadata.json",
    decimals: 6,
    authority: authority.publicKey,
  }
);

const tx = new Transaction().add(instruction);
await sendAndConfirmTransaction(connection, tx, [authority, mintKeypair]);

// 2. Assign a minter role and quota
const roleIx = await stablecoin.updateRoles({
  roleType: RoleType.Minter,
  user: authority.publicKey,
  active: true,
  authority: authority.publicKey,
});
const quotaIx = await stablecoin.updateMinter({
  minter: authority.publicKey,
  quota: new BN(1_000_000_000_000), // 1M tokens (6 decimals)
  authority: authority.publicKey,
});
const setupTx = new Transaction().add(roleIx, quotaIx);
await sendAndConfirmTransaction(connection, setupTx, [authority]);

// 3. Mint tokens using the fluent builder
const sig = await stablecoin
  .mint(new BN(1_000_000)) // 1 token
  .to(authority.publicKey)
  .by(authority)
  .send(authority);

console.log("Minted! Signature:", sig);
```

---

## Presets

SSS provides two opinionated preset configurations:

```typescript
import { Presets } from "@stbr/sss-core-sdk";

// SSS-1: Minimal stablecoin
// Mint, burn, freeze, pause, role-based access control
Presets.SSS_1 = {
  enablePermanentDelegate: false,
  enableTransferHook: false,
  defaultAccountFrozen: false,
};

// SSS-2: Compliant stablecoin
// Everything in SSS-1 + blacklist enforcement + token seizure
Presets.SSS_2 = {
  enablePermanentDelegate: true,
  enableTransferHook: true,
  defaultAccountFrozen: false,
};
```

You can also create custom configurations by passing individual flags:

```typescript
// Custom: permanent delegate enabled, but no transfer hook
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    name: "Custom Stable",
    symbol: "CSTB",
    uri: "",
    decimals: 6,
    authority: wallet.publicKey,
    enablePermanentDelegate: true,
    enableTransferHook: false,
    defaultAccountFrozen: false,
  }
);
```

---

## Creating a Stablecoin

### SSS-1 (Minimal)

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-core-sdk";

const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    ...Presets.SSS_1,
    name: "USD Stablecoin",
    symbol: "USDS",
    uri: "https://example.com/metadata.json",
    decimals: 6,
    authority: wallet.publicKey,
  }
);

const tx = new Transaction().add(instruction);
await sendAndConfirmTransaction(connection, tx, [wallet, mintKeypair]);

console.log("Mint address:", mintKeypair.publicKey.toBase58());
console.log("Config PDA:", stablecoin.configAddress.toBase58());
```

### SSS-2 (Compliant)

SSS-2 requires a deployed transfer hook program ID:

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-core-sdk";

const HOOK_PROGRAM_ID = new PublicKey("Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH");

const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    ...Presets.SSS_2,
    name: "Compliant USD",
    symbol: "cUSD",
    uri: "https://example.com/metadata.json",
    decimals: 6,
    authority: wallet.publicKey,
    transferHookProgramId: HOOK_PROGRAM_ID,
  }
);

const tx = new Transaction().add(instruction);
await sendAndConfirmTransaction(connection, tx, [wallet, mintKeypair]);

// SSS-2 stablecoins have compliance features available
console.log("Compliance enabled:", true);
console.log("Permanent delegate:", true);
console.log("Transfer hook:", HOOK_PROGRAM_ID.toBase58());
```

### Loading an Existing Stablecoin

```typescript
const stablecoin = await SolanaStablecoin.load(connection, mintAddress);

// Inspect configuration
const config = await stablecoin.getConfig();
console.log("Name:", config.name);
console.log("Symbol:", config.symbol);
console.log("Decimals:", config.decimals);
console.log("Paused:", config.paused);
console.log("Transfer hook:", config.enableTransferHook);
console.log("Permanent delegate:", config.enablePermanentDelegate);
console.log("Master authority:", config.masterAuthority.toBase58());
```

---

## Operations (Params API)

Every write method accepts a params object and returns a `TransactionInstruction`. You build a `Transaction`, add the instruction, and sign it manually.

### Mint Tokens

```typescript
import BN from "bn.js";

const mintIx = await stablecoin.mint({
  amount: new BN(1_000_000), // 1 token with 6 decimals
  recipientTokenAccount: recipientAta,
  minter: minterKeypair.publicKey,
});

const tx = new Transaction().add(mintIx);
await sendAndConfirmTransaction(connection, tx, [wallet, minterKeypair]);
```

### Burn Tokens

```typescript
const burnIx = await stablecoin.burn({
  amount: new BN(500_000),
  fromTokenAccount: burnerAta,
  burner: burnerKeypair.publicKey,
});

const tx = new Transaction().add(burnIx);
await sendAndConfirmTransaction(connection, tx, [wallet, burnerKeypair]);
```

### Freeze and Thaw Accounts

```typescript
const freezeIx = await stablecoin.freeze({
  tokenAccount: targetAta,
  authority: pauserPubkey,
});

const thawIx = await stablecoin.thaw({
  tokenAccount: targetAta,
  authority: pauserPubkey,
});
```

### Pause and Unpause

```typescript
// Pause all minting and burning globally
const pauseIx = await stablecoin.pause({ authority: pauserPubkey });

// Resume operations
const unpauseIx = await stablecoin.unpause({ authority: pauserPubkey });
```

### Manage Roles

```typescript
import { RoleType } from "@stbr/sss-core-sdk";

// Assign a minter role
const assignIx = await stablecoin.updateRoles({
  roleType: RoleType.Minter,
  user: newMinterPubkey,
  active: true,
  authority: masterAuthority,
});

// Revoke a minter role
const revokeIx = await stablecoin.updateRoles({
  roleType: RoleType.Minter,
  user: newMinterPubkey,
  active: false,
  authority: masterAuthority,
});

// Available roles: Minter(0), Burner(1), Pauser(2), Blacklister(3), Seizer(4)
```

### Update Minter Quota

```typescript
const quotaIx = await stablecoin.updateMinter({
  minter: minterPubkey,
  quota: new BN(1_000_000_000_000), // 1M tokens
  authority: masterAuthority,
});
```

### Transfer Authority

```typescript
const transferIx = await stablecoin.transferAuthority({
  newAuthority: newMasterAuthorityPubkey,
  authority: currentMasterAuthority,
});
```

---

## Fluent Builder API

Every operation supports a fluent (chainable) API as an alternative to the params object. Pass a simple value instead of a params object to get a builder:

### Mint with Builder

```typescript
// Mint 1M tokens to a wallet, auto-deriving the ATA
const sig = await stablecoin
  .mint(new BN(1_000_000_000))
  .to(recipientWallet)          // auto-derives ATA from wallet address
  .by(minterKeypair)            // Keypair = auto-collected as signer
  .send(payerKeypair);

// Or specify a token account directly
const sig = await stablecoin
  .mint(new BN(1_000_000_000))
  .toAccount(recipientTokenAccount)
  .by(minterKeypair)
  .send(payerKeypair);

// Create the recipient's ATA if it doesn't exist
const sig = await stablecoin
  .mint(new BN(1_000_000_000))
  .to(recipientWallet)
  .by(minterKeypair)
  .createAccountIfNeeded()
  .send(payerKeypair);
```

### Burn with Builder

```typescript
const sig = await stablecoin
  .burn(new BN(500_000))
  .from(ownerWallet)            // auto-derives ATA
  .by(burnerKeypair)
  .send(payerKeypair);
```

### Freeze / Thaw with Builder

```typescript
// Freeze a wallet's token account
const sig = await stablecoin
  .freeze(targetWallet)
  .by(pauserKeypair)
  .send(payerKeypair);

// Thaw it
const sig = await stablecoin
  .thaw(targetWallet)
  .by(pauserKeypair)
  .send(payerKeypair);
```

### Pause / Unpause with Builder

```typescript
const sig = await stablecoin
  .pause()
  .by(pauserKeypair)
  .send(payerKeypair);

const sig = await stablecoin
  .unpause()
  .by(pauserKeypair)
  .send(payerKeypair);
```

### Role Management with Builder

```typescript
// Activate a minter role
const sig = await stablecoin
  .updateRoles(RoleType.Minter, newMinterPubkey)
  .activate()
  .by(masterKeypair)
  .send(masterKeypair);

// Deactivate it
const sig = await stablecoin
  .updateRoles(RoleType.Minter, newMinterPubkey)
  .deactivate()
  .by(masterKeypair)
  .send(masterKeypair);
```

### Minter Quota with Builder

```typescript
const sig = await stablecoin
  .updateMinter(minterPubkey)
  .quota(new BN(5_000_000_000_000)) // 5M tokens
  .by(masterKeypair)
  .send(masterKeypair);
```

### Transfer Authority with Builder

```typescript
const sig = await stablecoin
  .transferAuthority(newAuthorityPubkey)
  .by(currentAuthorityKeypair)
  .send(currentAuthorityKeypair);
```

### Builder Modifiers

All builders support these chainable modifiers:

```typescript
const sig = await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient)
  .by(minter)
  .withMemo("Monthly payroll distribution")     // Attach a memo instruction
  .withComputeBudget(400_000)                    // Set compute unit limit
  .withPriorityFee(50_000)                       // Set priority fee (microlamports)
  .withRetry({ maxRetries: 5 })                  // Enable retry on transient errors
  .withSimulation()                              // Dry-run before sending
  .send(payer);
```

### Getting Instructions and Transactions

Builders can produce raw instructions or unsigned transactions for custom composition:

```typescript
// Get the raw TransactionInstruction(s)
const instructions = await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient)
  .by(minter)
  .withMemo("test")
  .instruction();

// Get an unsigned Transaction (ready to sign)
const transaction = await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient)
  .by(minter)
  .transaction(payerPubkey);

// Add custom instructions before/after the main operation
const sig = await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient)
  .by(minter)
  .prepend(createAtaInstruction)   // runs before mint
  .append(logInstruction)          // runs after mint
  .send(payer);
```

---

## Batch Operations

Perform multiple operations in a single atomic transaction. If any operation fails, the entire transaction is rolled back.

### Batch Mint

Mint to multiple recipients in one transaction:

```typescript
const sig = await stablecoin
  .batchMint([
    { amount: new BN(1_000_000), to: walletA },
    { amount: new BN(2_000_000), to: walletB },
    { amount: new BN(500_000),   to: walletC },
  ])
  .by(minterKeypair)
  .createAccountsIfNeeded()  // auto-create ATAs for recipients
  .withMemo("Batch distribution")
  .send(payerKeypair);

// ATA creation instructions are deduplicated and ordered first,
// then all mint instructions follow.
```

### Batch Burn

Burn from multiple accounts:

```typescript
const sig = await stablecoin
  .batchBurn([
    { amount: new BN(500_000), from: walletA },
    { amount: new BN(750_000), from: walletB },
  ])
  .by(burnerKeypair)
  .send(payerKeypair);
```

### Batch Freeze / Thaw

Freeze or thaw multiple wallets:

```typescript
const sig = await stablecoin
  .batchFreeze([walletA, walletB, walletC])
  .by(pauserKeypair)
  .send(payerKeypair);

const sig = await stablecoin
  .batchThaw([walletA, walletB, walletC])
  .by(pauserKeypair)
  .send(payerKeypair);
```

### Batch Blacklist (SSS-2)

```typescript
// Blacklist multiple addresses
const sig = await stablecoin.compliance
  .batchBlacklistAdd([
    { address: userA, reason: "OFAC SDN match" },
    { address: userB, reason: "Fraud investigation" },
    { address: userC },  // reason is optional
  ])
  .by(blacklisterKeypair)
  .send(payerKeypair);

// Remove multiple from blacklist
const sig = await stablecoin.compliance
  .batchBlacklistRemove([userA, userB, userC])
  .by(blacklisterKeypair)
  .send(payerKeypair);
```

### Composing Mixed Operations

Use `BatchBuilder` to combine different operation types into one transaction:

```typescript
import { BatchBuilder } from "@stbr/sss-core-sdk";

const mintOp = stablecoin
  .mint(new BN(1_000_000))
  .to(recipientA)
  .by(minterKeypair);

const freezeOp = stablecoin
  .freeze(suspiciousWallet)
  .by(pauserKeypair);

// Combine into a single atomic transaction
const sig = await stablecoin
  .batch()
  .add(mintOp)
  .add(freezeOp)
  .withComputeBudget(600_000)
  .send(payerKeypair, [minterKeypair, pauserKeypair]);
```

---

## Event Parsing

Every SSS instruction emits a typed event. The SDK provides tools to parse these events from transaction logs.

### Parse Events from Transaction Logs

```typescript
import { SSSEventParser, SSSEventName } from "@stbr/sss-core-sdk";

const parser = new SSSEventParser(stablecoin.program);

// Parse events from raw log strings
const events = parser.parseEvents(transactionLogs);

for (const event of events) {
  console.log(`Event: ${event.name}`);
  console.log(`Data:`, event.data);
}
```

### Parse Events from a Transaction Signature

```typescript
const events = await parser.parseTransaction(connection, txSignature);

for (const event of events) {
  switch (event.name) {
    case SSSEventName.TokensMinted:
      console.log(`Minted ${event.data.amount} to ${event.data.recipientTokenAccount}`);
      break;
    case SSSEventName.TokensBurned:
      console.log(`Burned ${event.data.amount} from ${event.data.fromTokenAccount}`);
      break;
    case SSSEventName.AddressBlacklisted:
      console.log(`Blacklisted ${event.data.address}: ${event.data.reason}`);
      break;
    // TypeScript narrows event.data based on event.name
  }
}
```

### Filter Events by Type

```typescript
const allEvents = await parser.parseTransaction(connection, txSignature);

// Type-safe filtering — return type is automatically narrowed
const mintEvents = parser.filterEvents(allEvents, SSSEventName.TokensMinted);
// mintEvents is TypedEvent<"TokensMinted", TokensMintedEvent>[]

for (const mint of mintEvents) {
  console.log(`Minted: ${mint.data.amount.toString()} tokens`);
  console.log(`Minter: ${mint.data.minter.toBase58()}`);
  console.log(`New supply: ${mint.data.newTotalSupply.toString()}`);
}
```

### Real-Time Event Subscriptions (WebSocket)

```typescript
// Subscribe to a specific event type
const listenerId = parser.addEventListener(
  connection,
  SSSEventName.TokensMinted,
  (event, slot, signature) => {
    console.log(`[slot ${slot}] Mint detected: ${event.data.amount}`);
    console.log(`  Signature: ${signature}`);
  }
);

// Subscribe to ALL event types
const listenerIds = parser.addAllEventListeners(
  connection,
  (event, slot, signature) => {
    console.log(`[${event.name}] at slot ${slot}`);
  }
);

// Clean up subscriptions
await parser.removeEventListener(connection, listenerId);
await parser.removeAllEventListeners(connection, listenerIds);
```

### Standalone Convenience Functions

```typescript
import { parseEvents, parseTransaction } from "@stbr/sss-core-sdk";

// One-off parsing without creating a parser instance
const events = parseEvents(program, transactionLogs);
const events = await parseTransaction(program, connection, signature);
```

### All Event Types

| Event Name | Key Fields |
|---|---|
| `StablecoinInitialized` | `config`, `mint`, `authority`, `name`, `symbol` |
| `TokensMinted` | `config`, `minter`, `recipientTokenAccount`, `amount`, `newTotalSupply` |
| `TokensBurned` | `config`, `burner`, `fromTokenAccount`, `amount`, `newTotalSupply` |
| `AccountFrozen` | `config`, `authority`, `tokenAccount` |
| `AccountThawed` | `config`, `authority`, `tokenAccount` |
| `StablecoinPaused` | `config`, `authority` |
| `StablecoinUnpaused` | `config`, `authority` |
| `RoleUpdated` | `config`, `authority`, `user`, `roleType`, `active` |
| `MinterQuotaUpdated` | `config`, `authority`, `minter`, `newQuota` |
| `AuthorityTransferred` | `config`, `oldAuthority`, `newAuthority` |
| `AddressBlacklisted` | `config`, `authority`, `address`, `reason` |
| `AddressUnblacklisted` | `config`, `authority`, `address` |
| `TokensSeized` | `config`, `authority`, `from`, `to`, `amount` |

---

## Retry and Error Recovery

The SDK classifies RPC errors as transient (retry-safe) or permanent (fail-fast) and provides automatic retry with exponential backoff.

### Using Retry with Builders

```typescript
// Enable retry with default settings (3 retries, 500ms initial delay, 2x backoff)
const sig = await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient)
  .by(minter)
  .withRetry()
  .send(payer);

// Custom retry configuration
const sig = await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient)
  .by(minter)
  .withRetry({
    maxRetries: 5,
    initialDelayMs: 1000,
    maxDelayMs: 30_000,
    backoffMultiplier: 2.0,
    jitter: true,
    onRetry: (error, attempt, delay) => {
      console.log(`Retry ${attempt}: ${error.message} (waiting ${delay}ms)`);
    },
  })
  .send(payer);
```

### Standalone Retry Wrapper

Use `withRetry` for any async operation, not just SDK builders:

```typescript
import { withRetry, DEFAULT_RETRY_CONFIG } from "@stbr/sss-core-sdk";

// Retry any async function
const result = await withRetry(
  () => connection.getLatestBlockhash(),
  { maxRetries: 3, initialDelayMs: 500 }
);

// Retry a custom operation with full config
const sig = await withRetry(async () => {
  const tx = new Transaction().add(myInstruction);
  return sendAndConfirmTransaction(connection, tx, [wallet]);
});
```

### Error Classification

```typescript
import { isTransientError, SSSTransactionError } from "@stbr/sss-core-sdk";

try {
  await stablecoin.mint(new BN(1_000_000)).to(recipient).by(minter).withRetry().send(payer);
} catch (error) {
  if (error instanceof SSSTransactionError) {
    console.log("Attempts made:", error.attempts);
    console.log("Was transient:", error.wasTransient);
    console.log("Original error:", error.cause.message);
  }
}

// Check manually whether an error is transient
if (isTransientError(someError)) {
  // Safe to retry: rate limit, timeout, network failure, blockhash expired
} else {
  // Permanent: insufficient funds, account not found, program error
}
```

**Transient errors** (retried automatically): 429 rate limits, request timeouts, network failures, blockhash expiry, `ECONNREFUSED`, `ETIMEDOUT`, 502/503/504 gateway errors.

**Permanent errors** (fail immediately): insufficient funds, account not found, program errors, invalid instruction data, signature verification failures.

---

## Transaction Simulation

Dry-run transactions before spending SOL. The SDK parses raw simulation output into human-readable diagnostics.

### Pre-Flight Simulation with Builders

```typescript
// Simulate before sending — throws SSSSimulationError on failure
const sig = await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient)
  .by(minter)
  .withSimulation()  // enables pre-flight check
  .send(payer);
// If simulation fails, no transaction is sent. No SOL spent.
```

### Non-Throwing Dry Run

```typescript
const result = await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient)
  .by(minter)
  .dryRun(payer.publicKey);

if (result.success) {
  console.log("Simulation passed!");
  console.log("Compute units:", result.unitsConsumed);
} else {
  console.log("Would fail:", result.error);
  if (result.programError) {
    console.log("Program:", result.programError.program);  // "SSS", "TransferHook", "Token", "Anchor"
    console.log("Error:", result.programError.name);        // e.g., "Paused", "Unauthorized"
    console.log("Code:", result.programError.code);         // e.g., 6004
    console.log("Message:", result.programError.message);
  }
}
```

### Throwing Simulation

```typescript
import { SSSSimulationError, formatSimulationError } from "@stbr/sss-core-sdk";

try {
  const result = await stablecoin
    .mint(new BN(1_000_000))
    .to(recipient)
    .by(minter)
    .simulate(payer.publicKey);
  // simulate() throws on failure
} catch (error) {
  if (error instanceof SSSSimulationError) {
    console.log(formatSimulationError(error.simulationResult));
    // Output:
    //   Simulation failed: Paused — The stablecoin is currently paused
    //   Program: SSS (code 6004)
    //   Compute units consumed: 12,345
    //   --- Last 20 log lines ---
    //   ...
  }
}
```

### Standalone Simulation

```typescript
import { simulateTransaction, formatSimulationError } from "@stbr/sss-core-sdk";

const result = await simulateTransaction(connection, transaction);
if (!result.success) {
  console.error(formatSimulationError(result));
}
```

### SimulationResult Interface

```typescript
interface SimulationResult {
  success: boolean;
  error: string | null;         // Human-readable error message
  programError: ProgramError | null;  // Parsed program error details
  unitsConsumed: number;        // Compute units used
  logs: string[];               // Full transaction logs
  raw: RpcResponseAndContext<SimulatedTransactionResponse>;
}

interface ProgramError {
  program: string;   // "SSS" | "TransferHook" | "Token" | "Anchor"
  code: number;      // Numeric error code
  name: string;      // Human-readable name (e.g., "Unauthorized")
  message: string;   // Detailed description
}
```

---

## Read Methods

```typescript
const stablecoin = await SolanaStablecoin.load(connection, mintAddress);

// Get the full stablecoin configuration
const config = await stablecoin.getConfig();
// config.name, config.symbol, config.decimals, config.paused,
// config.masterAuthority, config.enableTransferHook,
// config.enablePermanentDelegate, config.totalMinted, config.totalBurned

// Get current supply from Token-2022
const supply = await stablecoin.getSupply();
// supply.amount (raw string), supply.decimals, supply.uiAmount (human-readable)

// Get a minter's quota and cumulative minted amount
const quota = await stablecoin.getMinterQuota(minterPubkey);
// quota.quota (BN), quota.minted (BN)

// Check if a user has an active role
const role = await stablecoin.getRole(RoleType.Minter, userPubkey);
// role.active (boolean), role.roleType, role.user
```

---

## PDA Helpers

Derive program-derived addresses without loading the full SDK:

```typescript
import {
  getConfigAddress,
  getRoleAddress,
  getMinterQuotaAddress,
  getBlacklistEntryAddress,
  getExtraAccountMetasAddress,
} from "@stbr/sss-core-sdk";

// StablecoinConfig PDA
const [configPda, configBump] = getConfigAddress(programId, mintAddress);

// RoleAccount PDA
const [rolePda, roleBump] = getRoleAddress(
  programId, configPda, RoleType.Minter, userPubkey
);

// MinterQuota PDA
const [quotaPda, quotaBump] = getMinterQuotaAddress(
  programId, configPda, minterPubkey
);

// BlacklistEntry PDA (SSS-2)
const [blacklistPda, blBump] = getBlacklistEntryAddress(
  programId, configPda, addressToCheck
);

// ExtraAccountMetas PDA (Transfer Hook program)
const [metasPda, metasBump] = getExtraAccountMetasAddress(
  hookProgramId, mintAddress
);
```

---

## Compliance SDK (`@stbr/sss-compliance-sdk`)

The compliance SDK provides advanced blacklist management, audit trail queries, and compliance summary for SSS-2 stablecoins.

### Access via SolanaStablecoin

The compliance module is automatically available on SSS-2 stablecoin instances:

```typescript
const stablecoin = await SolanaStablecoin.load(connection, mintAddress);

// stablecoin.compliance is a ComplianceModule instance
```

### Blacklist Operations

#### Params API

```typescript
// Add to blacklist
const addIx = await stablecoin.compliance.blacklistAdd({
  address: suspiciousUser,
  reason: "OFAC SDN list match",
  authority: blacklisterPubkey,
});

// Remove from blacklist
const removeIx = await stablecoin.compliance.blacklistRemove({
  address: clearedUser,
  authority: blacklisterPubkey,
});
```

#### Fluent Builder API

```typescript
// Add to blacklist with builder
const sig = await stablecoin.compliance
  .blacklistAdd(suspiciousUser)
  .reason("OFAC SDN list match")
  .by(blacklisterKeypair)
  .send(payerKeypair);

// Remove from blacklist with builder
const sig = await stablecoin.compliance
  .blacklistRemove(clearedUser)
  .by(blacklisterKeypair)
  .send(payerKeypair);
```

### Seize Tokens (SSS-2)

Seize tokens from a blacklisted account using the permanent delegate:

```typescript
// Params API
const seizeIx = await stablecoin.compliance.seize({
  fromTokenAccount: targetAta,
  toTokenAccount: treasuryAta,
  amount: new BN(100_000),
  authority: seizerPubkey,
});

// Fluent Builder API — auto-derives ATAs from wallet addresses
const sig = await stablecoin.compliance
  .seize(new BN(100_000))
  .from(blacklistedWallet)
  .to(treasuryWallet)
  .by(seizerKeypair)
  .send(payerKeypair);
```

### Query Blacklist

```typescript
// Check if a specific address is blacklisted
const isBlacklisted = await stablecoin.compliance.isBlacklisted(address);

// Get details of a blacklist entry
const entry = await stablecoin.compliance.getBlacklistEntry(address);
if (entry) {
  console.log("Reason:", entry.reason);
  console.log("Blacklisted by:", entry.blacklistedBy.toBase58());
  console.log("Blacklisted at:", new Date(entry.blacklistedAt.toNumber() * 1000));
}

// Get all blacklisted addresses
const allEntries = await stablecoin.compliance.getBlacklist();
for (const { pubkey, account } of allEntries) {
  console.log(`${account.address.toBase58()} — ${account.reason}`);
}
```

### BlacklistManager (Direct Access)

```typescript
import { ComplianceModule } from "@stbr/sss-compliance-sdk";

const compliance = new ComplianceModule(program, connection, mint, configPda);

// Direct blacklist manager access
const isBlocked = await compliance.blacklist.isBlacklisted(address);
const entry = await compliance.blacklist.get(address);
const all = await compliance.blacklist.getAll();
```

### Audit Log

Query the on-chain audit trail:

```typescript
// Get recent audit entries
const entries = await compliance.audit.getEntries({ limit: 50 });

for (const entry of entries) {
  console.log(`[${new Date(entry.timestamp * 1000).toISOString()}]`);
  console.log(`  Action: ${entry.action}`);
  console.log(`  Signature: ${entry.signature}`);
  console.log(`  Details:`, entry.details);
}

// Filter by action type
const mints = await compliance.audit.getEntries({
  action: "TokensMinted",
  limit: 100,
});

// Filter by time range
const recent = await compliance.audit.getEntries({
  fromTimestamp: Math.floor(Date.now() / 1000) - 86400, // last 24 hours
  toTimestamp: Math.floor(Date.now() / 1000),
});
```

### Compliance Summary

```typescript
const summary = await compliance.getSummary();
console.log("Compliance enabled:", summary.complianceEnabled);
console.log("Seize enabled:", summary.seizeEnabled);
console.log("Blacklisted addresses:", summary.blacklistedCount);
console.log("Total minted:", summary.totalMinted);
console.log("Total burned:", summary.totalBurned);
```

---

## End-to-End Workflows

### Workflow 1: Launch an SSS-1 Stablecoin

Complete lifecycle from initialization to operations:

```typescript
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { SolanaStablecoin, Presets, RoleType } from "@stbr/sss-core-sdk";
import BN from "bn.js";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const authority = Keypair.generate();
const minter = Keypair.generate();
const recipient = Keypair.generate();

// Fund accounts (localnet)
await connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
await connection.requestAirdrop(minter.publicKey, 1 * LAMPORTS_PER_SOL);

// Step 1: Create the stablecoin
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    ...Presets.SSS_1,
    name: "Test USD",
    symbol: "tUSD",
    uri: "",
    decimals: 6,
    authority: authority.publicKey,
  }
);

const initTx = new Transaction().add(instruction);
await sendAndConfirmTransaction(connection, initTx, [authority, mintKeypair]);

// Step 2: Assign minter role + set quota
const roleIx = await stablecoin.updateRoles({
  roleType: RoleType.Minter,
  user: minter.publicKey,
  active: true,
  authority: authority.publicKey,
});
const quotaIx = await stablecoin.updateMinter({
  minter: minter.publicKey,
  quota: new BN(10_000_000_000), // 10,000 tokens
  authority: authority.publicKey,
});
const setupTx = new Transaction().add(roleIx, quotaIx);
await sendAndConfirmTransaction(connection, setupTx, [authority]);

// Step 3: Mint tokens using the fluent builder
const mintSig = await stablecoin
  .mint(new BN(1_000_000_000)) // 1,000 tokens
  .to(recipient.publicKey)
  .by(minter)
  .createAccountIfNeeded()
  .withRetry()
  .send(minter);

console.log("Mint signature:", mintSig);

// Step 4: Check supply
const supply = await stablecoin.getSupply();
console.log("Total supply:", supply.uiAmount, supply.decimals === 6 ? "tUSD" : "");

// Step 5: Assign burner role and burn tokens
const burnerRoleIx = await stablecoin.updateRoles({
  roleType: RoleType.Burner,
  user: minter.publicKey,
  active: true,
  authority: authority.publicKey,
});
await sendAndConfirmTransaction(
  connection,
  new Transaction().add(burnerRoleIx),
  [authority]
);

const burnSig = await stablecoin
  .burn(new BN(500_000_000)) // 500 tokens
  .from(recipient.publicKey)
  .by(minter)
  .send(minter);

console.log("Burn signature:", burnSig);
```

### Workflow 2: SSS-2 Compliance Operations

Blacklist an address, block transfers, seize tokens:

```typescript
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { SolanaStablecoin, Presets, RoleType } from "@stbr/sss-core-sdk";
import BN from "bn.js";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const authority = Keypair.generate();
const blacklister = Keypair.generate();
const seizer = Keypair.generate();
const suspectWallet = Keypair.generate();
const treasury = Keypair.generate();

const HOOK_PROGRAM_ID = new PublicKey("Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH");

// Create SSS-2 stablecoin (with compliance features)
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    ...Presets.SSS_2,
    name: "Compliant USD",
    symbol: "cUSD",
    uri: "",
    decimals: 6,
    authority: authority.publicKey,
    transferHookProgramId: HOOK_PROGRAM_ID,
  }
);
await sendAndConfirmTransaction(
  connection,
  new Transaction().add(instruction),
  [authority, mintKeypair]
);

// Assign compliance roles
const roles = [
  { roleType: RoleType.Blacklister, user: blacklister.publicKey },
  { roleType: RoleType.Seizer, user: seizer.publicKey },
];
for (const { roleType, user } of roles) {
  const ix = await stablecoin.updateRoles({
    roleType, user, active: true, authority: authority.publicKey,
  });
  await sendAndConfirmTransaction(connection, new Transaction().add(ix), [authority]);
}

// Blacklist a suspicious address
const blSig = await stablecoin.compliance
  .blacklistAdd(suspectWallet.publicKey)
  .reason("Sanctions screening — OFAC SDN list match")
  .by(blacklister)
  .send(blacklister);

console.log("Blacklisted. Signature:", blSig);

// Verify blacklist status
const isBlocked = await stablecoin.compliance.isBlacklisted(suspectWallet.publicKey);
console.log("Is blacklisted:", isBlocked); // true

// Any transfer_checked involving this address will now be rejected
// by the transfer hook program.

// Seize tokens from the blacklisted account to treasury
const seizeSig = await stablecoin.compliance
  .seize(new BN(1_000_000))
  .from(suspectWallet.publicKey)
  .to(treasury.publicKey)
  .by(seizer)
  .send(seizer);

console.log("Tokens seized. Signature:", seizeSig);

// Remove from blacklist after investigation
const unblockSig = await stablecoin.compliance
  .blacklistRemove(suspectWallet.publicKey)
  .by(blacklister)
  .send(blacklister);

console.log("Unblocked. Signature:", unblockSig);
```

### Workflow 3: Batch Payroll Distribution

Mint to multiple employees in a single transaction:

```typescript
import { SolanaStablecoin } from "@stbr/sss-core-sdk";
import BN from "bn.js";

const stablecoin = await SolanaStablecoin.load(connection, mintAddress);

// Define payroll recipients
const payroll = [
  { to: employee1.publicKey, amount: new BN(5_000_000_000) },  // $5,000
  { to: employee2.publicKey, amount: new BN(7_500_000_000) },  // $7,500
  { to: employee3.publicKey, amount: new BN(3_200_000_000) },  // $3,200
  { to: employee4.publicKey, amount: new BN(4_800_000_000) },  // $4,800
];

// One atomic transaction: creates ATAs if needed, then mints all
const sig = await stablecoin
  .batchMint(payroll)
  .by(payrollMinterKeypair)
  .createAccountsIfNeeded()
  .withMemo("February 2026 payroll")
  .withRetry({ maxRetries: 3 })
  .withSimulation()
  .send(payerKeypair);

console.log("Payroll distributed:", sig);
```

### Workflow 4: Authority Rotation

Transfer master authority to a new keypair:

```typescript
const stablecoin = await SolanaStablecoin.load(connection, mintAddress);

// Transfer authority
const sig = await stablecoin
  .transferAuthority(newAuthority.publicKey)
  .by(currentAuthority)
  .send(currentAuthority);

// Old authority can no longer assign roles or transfer authority.
// Existing role-holders keep their roles until the new authority revokes them.
// The new authority should revoke old roles and assign new ones:

const revokeIx = await stablecoin.updateRoles({
  roleType: RoleType.Minter,
  user: oldMinter.publicKey,
  active: false,
  authority: newAuthority.publicKey,
});
await sendAndConfirmTransaction(connection, new Transaction().add(revokeIx), [newAuthority]);
```

### Workflow 5: Monitor Events in Real Time

Set up a live event stream for operational monitoring:

```typescript
import { SSSEventParser, SSSEventName } from "@stbr/sss-core-sdk";

const parser = new SSSEventParser(stablecoin.program);

// Monitor all compliance-critical events
const listenerIds: number[] = [];

listenerIds.push(
  parser.addEventListener(connection, SSSEventName.TokensMinted, (event, slot) => {
    console.log(`[MINT] ${event.data.amount} tokens at slot ${slot}`);
  })
);

listenerIds.push(
  parser.addEventListener(connection, SSSEventName.AddressBlacklisted, (event, slot) => {
    console.log(`[BLACKLIST] ${event.data.address} — ${event.data.reason}`);
  })
);

listenerIds.push(
  parser.addEventListener(connection, SSSEventName.TokensSeized, (event, slot) => {
    console.log(`[SEIZE] ${event.data.amount} from ${event.data.from} to ${event.data.to}`);
  })
);

listenerIds.push(
  parser.addEventListener(connection, SSSEventName.AuthorityTransferred, (event) => {
    console.log(`[AUTHORITY] ${event.data.oldAuthority} → ${event.data.newAuthority}`);
  })
);

// To stop monitoring:
// await parser.removeAllEventListeners(connection, listenerIds);
```

---

## Token-2022 Utilities

Helper functions for Token-2022 operations:

```typescript
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  createATAInstruction,
  getTokenBalance,
  getMintSupply,
  accountExists,
} from "@stbr/sss-core-sdk";

// Derive ATA for Token-2022
const ata = getAssociatedTokenAddress(mintAddress, ownerPubkey);

// Create ATA instruction
const createIx = createATAInstruction(mintAddress, ownerPubkey, payerPubkey);

// Check token balance
const balance = await getTokenBalance(connection, ata);

// Get mint supply
const supply = await getMintSupply(connection, mintAddress);

// Check if an account exists on-chain
const exists = await accountExists(connection, someAddress);
```
