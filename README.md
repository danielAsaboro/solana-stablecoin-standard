# Solana Stablecoin Standard (SSS)

> A modular, open-source framework for launching regulated stablecoins on Solana using the Token-2022 program.

SSS provides two preset configurations -- **SSS-1** (minimal) and **SSS-2** (compliant) -- so that issuers can go from zero to a fully operational stablecoin in minutes rather than months. Built on Anchor and Token-2022, it packages battle-tested patterns for role-based access control, mint quotas, on-chain blacklist enforcement, and forced seizure into a single cohesive toolkit.

---

## Table of Contents

- [Why SSS?](#why-sss)
- [Preset Comparison](#preset-comparison)
- [Architecture](#architecture)
- [Repository Layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Build and Test](#build-and-test)
- [Tutorial: Launch an SSS-1 Stablecoin](#tutorial-launch-an-sss-1-stablecoin)
- [Tutorial: Launch an SSS-2 Compliant Stablecoin](#tutorial-launch-an-sss-2-compliant-stablecoin)
- [Tutorial: TypeScript SDK](#tutorial-typescript-sdk)
- [Program IDs](#program-ids)
- [SDK Usage](#sdk-usage)
- [CLI Reference](#cli-reference)
- [Oracle Integration Module](#oracle-integration-module)
- [Admin TUI Dashboard](#admin-tui-dashboard)
- [Admin Frontend (Next.js)](#admin-frontend-nextjs)
- [Backend API](#backend-api)
- [Documentation](#documentation)
- [Security Model](#security-model)
- [Regulatory Alignment](#regulatory-alignment)
- [Contributing](#contributing)
- [License](#license)

---

## Why SSS?

Stablecoin issuers on Solana today must build bespoke smart contracts, compliance layers, and operational tooling from scratch. SSS eliminates this overhead with a single Anchor program, a clean TypeScript SDK, a CLI, and a backend API:

- **Role-based access control** -- Separate Minter, Burner, Pauser, Blacklister, and Seizer roles, each stored as individual PDAs that scale to unlimited role holders.
- **Token-2022 native** -- MetadataPointer, PermanentDelegate, and TransferHook extensions are configured at mint creation, not bolted on after the fact.
- **Quota system** -- Per-minter supply caps with cumulative tracking prevent runaway issuance.
- **Compliance-ready** -- On-chain blacklist enforcement via a transfer hook, token seizure via permanent delegate, and a full on-chain audit trail of every operation.
- **Two presets, one program** -- SSS-1 gives you the essentials. SSS-2 adds the compliance primitives regulators expect. Feature gating is enforced on-chain so SSS-1 mints can never be upgraded to have blacklist/seize capability -- users know exactly what they are getting at creation time.

---

## Preset Comparison

| Feature                    | SSS-1 (Minimal) | SSS-2 (Compliant) |
| -------------------------- | :--------------: | :----------------: |
| Token-2022 Mint            |        Y         |         Y          |
| On-chain Metadata          |        Y         |         Y          |
| Role-based Access Control  |        Y         |         Y          |
| Mint / Burn with Quotas    |        Y         |         Y          |
| Pause / Unpause            |        Y         |         Y          |
| Freeze / Thaw Accounts     |        Y         |         Y          |
| Transfer Authority         |        Y         |         Y          |
| Permanent Delegate (Seize) |                  |         Y          |
| Transfer Hook (Blacklist)  |                  |         Y          |
| On-chain Blacklist PDAs    |                  |         Y          |
| Blacklister Role           |                  |         Y          |
| Seizer Role                |                  |         Y          |

See [docs/SSS-1.md](docs/SSS-1.md) and [docs/SSS-2.md](docs/SSS-2.md) for the full specifications.

---

## Architecture

SSS follows a three-layer model:

```
Layer 3  Applications       CLI (sss-token)  |  Backend API (Rust/Axum)  |  Your App
                                   |                    |                      |
Layer 2  TypeScript SDK     @stbr/sss-core-sdk   |   @stbr/sss-compliance-sdk
                                   |                    |
Layer 1  On-chain Programs  SSS Program (sss)    |   Transfer Hook Program
                                   |                    |
         Solana             Token-2022  ·  Metadata  ·  PermanentDelegate  ·  TransferHook
```

**SSS Program** -- Core stablecoin logic. Creates a Token-2022 mint with optional extensions, manages roles, quotas, and compliance operations. The config PDA owns the mint authority, freeze authority, and permanent delegate.

**Transfer Hook Program** -- Implements the SPL Transfer Hook Interface. On every `transfer_checked`, Token-2022 CPIs into this program, which checks BlacklistEntry PDAs for the source and destination owners. If either is blacklisted, the transfer is rejected.

### PDA Layout

| Account            | Seeds                                   | Program       |
| ------------------- | --------------------------------------- | ------------- |
| StablecoinConfig    | `["stablecoin", mint]`                  | SSS           |
| RoleAccount         | `["role", config, role_type_u8, user]`  | SSS           |
| MinterQuota         | `["minter_quota", config, minter]`      | SSS           |
| BlacklistEntry      | `["blacklist", config, address]`        | SSS           |
| ExtraAccountMetas   | `["extra-account-metas", mint]`         | Transfer Hook |
| OracleConfig        | `["oracle_config", stablecoin_config]`  | Oracle        |

### Data Flow: Mint

```
Minter --> SDK.mint() --> SSS Program
  1. Verify Minter role (RoleAccount PDA)
  2. Check quota (MinterQuota PDA)
  3. Check not paused (StablecoinConfig)
  4. CPI: mint_to (Token-2022)
  5. Update total_minted, minter.minted
  6. Emit TokensMinted event
```

### Data Flow: Transfer with Blacklist (SSS-2)

```
User --> transfer_checked (Token-2022)
  1. Token-2022 reads TransferHook extension from mint
  2. Resolves ExtraAccountMetas PDA
  3. CPIs to Transfer Hook program
  4. Hook checks BlacklistEntry PDAs for source & dest owners
  5. If blacklisted --> error, transfer rolled back
  6. If clear --> transfer completes
```

For the full architecture document, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Repository Layout

```
solana-stablecoin-standard/
  programs/
    sss/                 Anchor program -- core stablecoin logic
    transfer-hook/       Anchor program -- blacklist enforcement hook
    oracle/              Anchor program -- Switchboard price feed integration
  sdk/
    core/                TypeScript SDK -- SolanaStablecoin class, presets, PDA helpers
    compliance/          TypeScript SDK -- ComplianceModule, BlacklistManager, AuditLog
  cli/                   CLI tool (sss-token) -- Commander.js wrapper for the SDK
  backend/               Rust/Axum REST API -- mint/burn endpoints, compliance, webhooks
  tests/                 Integration tests (Anchor/Mocha)
    sss-1.ts             SSS-1 preset end-to-end tests
    sss-2.ts             SSS-2 preset end-to-end tests
    transfer-hook.ts     Transfer hook blacklist enforcement tests
    seize.ts             Seize (permanent delegate) tests
    roles.ts             Role-based access control tests
    multi-minter.ts      Multi-minter quota tests
    edge-cases.ts        Edge case and error handling tests
  tui/                   Interactive admin dashboard (ratatui terminal UI)
  frontend/              Next.js admin panel (web-based management UI)
  trident-tests/         Fuzz tests (Trident)
  scripts/               Deployment and utility scripts
  docs/                  Detailed documentation
```

---

## Prerequisites

- **Rust** 1.75+ ([install](https://rustup.rs/))
- **Solana CLI** 1.18+ (`sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"`)
- **Anchor CLI** 0.31+ (`cargo install --git https://github.com/coral-xyz/anchor avm && avm install 0.31.1 && avm use 0.31.1`)
- **Node.js** 18+ and **Yarn** (`npm install -g yarn`)
- A funded Solana keypair (`solana-keygen new` or use an existing one)

---

## Quick Start

```bash
# 1. Clone and install dependencies
git clone https://github.com/stablebrr/solana-stablecoin-standard.git
cd solana-stablecoin-standard
yarn install

# 2. Build the on-chain programs
anchor build

# 3. Run the full test suite against a local validator
anchor test

# 4. Initialize an SSS-1 stablecoin (minimal preset)
sss-token init --preset sss-1 \
  --name "USD Stablecoin" \
  --symbol "USDS" \
  --decimals 6

# 5. Initialize an SSS-2 stablecoin (compliant preset)
sss-token init --preset sss-2 \
  --name "Compliant USD" \
  --symbol "cUSD" \
  --decimals 6 \
  --transfer-hook-program <HOOK_PROGRAM_ID>

# 6. Assign a minter and set a quota
sss-token roles assign --role minter --user <MINTER_PUBKEY>
sss-token minters add --minter <MINTER_PUBKEY> --quota 1000000000000

# 7. Mint tokens
sss-token mint --recipient <RECIPIENT_PUBKEY> --amount 1000000000

# 8. Check supply
sss-token supply
```

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for the full operations runbook.

---

## Build and Test

```bash
# Build both on-chain programs (SSS + Transfer Hook)
anchor build

# Run the full integration test suite (starts a local validator automatically)
anchor test

# Build the TypeScript SDK packages
yarn build

# Run SDK unit tests
yarn test:sdk

# Start the backend API server (local development)
cd backend && cargo run

# Start the backend with Docker Compose (includes PostgreSQL)
cd backend && docker compose up --build
```

### Test Coverage

The integration test suite covers seven test modules:

| Test File            | What It Covers                                           |
| -------------------- | -------------------------------------------------------- |
| `sss-1.ts`          | Full SSS-1 lifecycle: init, roles, mint, burn, freeze, pause |
| `sss-2.ts`          | Full SSS-2 lifecycle including blacklist and seize       |
| `transfer-hook.ts`  | Transfer hook enforcement, blacklisted transfers blocked |
| `seize.ts`          | Permanent delegate seizure, unauthorized seize rejection |
| `roles.ts`          | Role assignment, revocation, multi-role scenarios        |
| `multi-minter.ts`   | Multiple minters with independent quotas                 |
| `edge-cases.ts`     | Overflow, unauthorized access, paused state, quota exceeded |

---

## Tutorial: Launch an SSS-1 Stablecoin

This walkthrough takes you from zero to a fully operational SSS-1 stablecoin on a local Solana validator. Every command is copy-pasteable and every step is verified before moving on.

> **Time required:** ~5 minutes. No devnet SOL needed — the local validator gives unlimited airdrop.

### Step 1 — Start a local validator

```bash
# Start the local validator with both programs deployed
# (anchor test does this automatically, but for manual CLI usage you need it running)
solana-test-validator \
  --bpf-program DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu target/deploy/sss.so \
  --bpf-program Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH target/deploy/transfer_hook.so \
  --reset &

# Wait for the validator to start
sleep 3

# Point your Solana CLI to localhost
solana config set --url http://localhost:8899
```

### Step 2 — Fund your wallet

```bash
# Use your existing keypair or generate a new one
solana-keygen new --no-bip39-passphrase --outfile ~/.config/solana/id.json --force

# Airdrop SOL (instant on localnet)
solana airdrop 100
solana balance  # Should show 100 SOL
```

### Step 3 — Initialize the stablecoin

```bash
# Create an SSS-1 stablecoin with 6 decimals (like USDC)
npx ts-node cli/bin/sss-token.ts init \
  --preset sss-1 \
  --name "Tutorial USD" \
  --symbol "tUSD" \
  --decimals 6

# Output:
#   ℹ Using SSS-1 preset: basic stablecoin (no permanent delegate, no transfer hook)
#   ℹ Initializing stablecoin "Tutorial USD" (tUSD) with 6 decimals...
#   ℹ Mint: <MINT_ADDRESS>
#   ✔ Stablecoin initialized!
#   ℹ Config saved to .sss-token.json
```

The CLI saves the mint address and config PDA to `.sss-token.json`, so subsequent commands auto-discover the stablecoin.

### Step 4 — Check the stablecoin status

```bash
npx ts-node cli/bin/sss-token.ts status

# Output:
#   ─── Stablecoin Status ────────────────────
#   Name              Tutorial USD
#   Symbol            tUSD
#   Decimals          6
#   Mint              <MINT_ADDRESS>
#   Master Authority  <YOUR_PUBKEY>
#   Paused            NO
#   Permanent Delegate  Disabled
#   Transfer Hook       Disabled
#   Total Minted      0
#   Total Burned      0
#   Net Supply        0
```

### Step 5 — Assign roles and set a minter quota

The master authority (your keypair) must assign roles before anyone can operate. The `minters add` command assigns the minter role **and** sets a quota in one step.

```bash
# Get your public key
export MY_PUBKEY=$(solana address)

# Add yourself as a minter with a 1,000,000 tUSD quota (1M * 10^6 = 1_000_000_000_000 base units)
npx ts-node cli/bin/sss-token.ts minters add $MY_PUBKEY --quota 1000000000000

# Also assign the burner and pauser roles
npx ts-node cli/bin/sss-token.ts roles add burner $MY_PUBKEY
npx ts-node cli/bin/sss-token.ts roles add pauser $MY_PUBKEY

# Verify roles
npx ts-node cli/bin/sss-token.ts roles list $MY_PUBKEY

# Output:
#   ─── Roles for <YOUR_PUBKEY> ────────────────
#   Minter       ACTIVE
#   Burner       ACTIVE
#   Pauser       NOT ASSIGNED  (pauser role was just assigned, so it shows ACTIVE)
#   Blacklister  NOT ASSIGNED
#   Seizer       NOT ASSIGNED
```

### Step 6 — Mint tokens

```bash
# Generate a recipient wallet
solana-keygen new --no-bip39-passphrase --outfile /tmp/recipient.json --force
export RECIPIENT=$(solana-keygen pubkey /tmp/recipient.json)

# Fund the recipient so they can hold tokens (need SOL for ATA rent)
solana airdrop 1 $RECIPIENT

# Mint 10,000 tUSD (10_000 * 10^6 = 10_000_000_000 base units)
npx ts-node cli/bin/sss-token.ts mint $RECIPIENT 10000000000

# Check the updated supply
npx ts-node cli/bin/sss-token.ts supply

# Output:
#   ─── Supply Statistics ────────────────────
#   Total Minted   10000000000
#   Total Burned   0
#   Net Supply     10000000000
```

### Step 7 — Burn tokens

The burner burns from their own token account. Mint some to yourself first, then burn.

```bash
# Mint to yourself
npx ts-node cli/bin/sss-token.ts mint $MY_PUBKEY 5000000000

# Burn 1,000 tUSD from your account
npx ts-node cli/bin/sss-token.ts burn 1000000000

# Verify
npx ts-node cli/bin/sss-token.ts supply
# Net Supply should be 14000000000 (15B minted - 1B burned)
```

### Step 8 — Freeze and thaw an account

```bash
# Freeze the recipient's token account (blocks all transfers)
npx ts-node cli/bin/sss-token.ts freeze $RECIPIENT

# Thaw (unfreeze) the account
npx ts-node cli/bin/sss-token.ts thaw $RECIPIENT
```

### Step 9 — Pause and unpause

Pausing halts **all** minting and burning system-wide.

```bash
# Pause the stablecoin
npx ts-node cli/bin/sss-token.ts pause

# Try to mint — this will fail with "Paused" error
npx ts-node cli/bin/sss-token.ts mint $RECIPIENT 1000000
# Error: Paused

# Unpause to resume operations
npx ts-node cli/bin/sss-token.ts unpause
```

### Step 10 — Check minter quota usage

```bash
npx ts-node cli/bin/sss-token.ts minters list $MY_PUBKEY

# Output:
#   ─── Minter Info ────────────────────
#   Address    <YOUR_PUBKEY>
#   Active     YES
#   Quota      1000000000000
#   Minted     15000000000
#   Remaining  985000000000
```

You now have a fully operational SSS-1 stablecoin with role-based access control, mint quotas, freeze/thaw, and pause/unpause.

---

## Tutorial: Launch an SSS-2 Compliant Stablecoin

SSS-2 adds blacklist enforcement (via transfer hook) and token seizure (via permanent delegate) on top of all SSS-1 features. This tutorial assumes you have completed the prerequisite steps (validator running, wallet funded).

> **Important:** SSS-2 requires the Transfer Hook program to be deployed alongside the SSS program. Both are already loaded by `solana-test-validator` in [Step 1](#step-1--start-a-local-validator) above.

### Step 1 — Initialize SSS-2

```bash
# Initialize with the sss-2 preset (enables permanent delegate + transfer hook)
npx ts-node cli/bin/sss-token.ts init \
  --preset sss-2 \
  --name "Compliant USD" \
  --symbol "cUSD" \
  --decimals 6

# Output:
#   ℹ Using SSS-2 preset: compliance stablecoin (permanent delegate + transfer hook)
#   ✔ Stablecoin initialized!
```

Verify compliance features are enabled:

```bash
npx ts-node cli/bin/sss-token.ts status

# Output includes:
#   Permanent Delegate  Enabled
#   Transfer Hook       Enabled
#   Hook Program        Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH
```

### Step 2 — Assign compliance roles

SSS-2 adds two extra role types: **Blacklister** and **Seizer**.

```bash
export MY_PUBKEY=$(solana address)

# Assign all five roles to yourself for this tutorial
npx ts-node cli/bin/sss-token.ts minters add $MY_PUBKEY --quota 1000000000000
npx ts-node cli/bin/sss-token.ts roles add burner $MY_PUBKEY
npx ts-node cli/bin/sss-token.ts roles add pauser $MY_PUBKEY
npx ts-node cli/bin/sss-token.ts roles add blacklister $MY_PUBKEY
npx ts-node cli/bin/sss-token.ts roles add seizer $MY_PUBKEY
```

### Step 3 — Mint and distribute

```bash
# Create a user wallet
solana-keygen new --no-bip39-passphrase --outfile /tmp/user.json --force
export USER=$(solana-keygen pubkey /tmp/user.json)
solana airdrop 1 $USER

# Mint tokens to yourself and the user
npx ts-node cli/bin/sss-token.ts mint $MY_PUBKEY 50000000000
npx ts-node cli/bin/sss-token.ts mint $USER 10000000000
```

### Step 4 — Blacklist an address

When a wallet is blacklisted, the transfer hook rejects **all** incoming and outgoing transfers for that address at the Token-2022 protocol level.

```bash
# Blacklist the user (e.g., sanctions match)
npx ts-node cli/bin/sss-token.ts blacklist add $USER --reason "OFAC SDN match"

# Output:
#   ✔ Address blacklisted!
#   Address  <USER_PUBKEY>
#   Reason   OFAC SDN match
```

Any `transfer_checked` involving this user's token account will now fail with "BlacklistedAddress" at the transfer hook level.

### Step 5 — Seize tokens

The permanent delegate allows seizing tokens from any account without the holder's signature — required for court-ordered asset recovery.

```bash
# Create a treasury wallet to receive seized funds
solana-keygen new --no-bip39-passphrase --outfile /tmp/treasury.json --force
export TREASURY=$(solana-keygen pubkey /tmp/treasury.json)
solana airdrop 1 $TREASURY

# Seize all 10,000 cUSD from the blacklisted user
npx ts-node cli/bin/sss-token.ts seize $USER --to $TREASURY --amount 10000000000

# Output:
#   ✔ Tokens seized!
#   From    <USER_PUBKEY>
#   To      <TREASURY_PUBKEY>
#   Amount  10000000000
```

### Step 6 — Remove from blacklist

After compliance review, addresses can be unblocked.

```bash
npx ts-node cli/bin/sss-token.ts blacklist remove $USER
```

### Full SSS-2 lifecycle summary

```
1. init --preset sss-2          Create compliant stablecoin
2. roles add blacklister/seizer  Assign compliance roles
3. minters add + mint            Issue tokens
4. blacklist add <addr>          Block sanctioned address (transfers fail)
5. seize <addr> --to <treasury>  Recover assets via permanent delegate
6. blacklist remove <addr>       Unblock after review
```

---

## Tutorial: TypeScript SDK

For programmatic integration, use the TypeScript SDK directly. This example creates an SSS-1 stablecoin and performs the same operations as the CLI tutorial above.

### Installation

```bash
yarn add @stbr/sss-core-sdk @stbr/sss-compliance-sdk
```

### Complete example: SSS-1 lifecycle

```typescript
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { SolanaStablecoin, Presets } from "@stbr/sss-core-sdk";
import { sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import BN from "bn.js";

async function main() {
  // 1. Connect to local validator
  const connection = new Connection("http://localhost:8899", "confirmed");
  const authority = Keypair.generate();

  // Fund the authority
  const airdropSig = await connection.requestAirdrop(
    authority.publicKey,
    10 * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(airdropSig);

  // 2. Create an SSS-1 stablecoin
  const { stablecoin, mintKeypair, instruction } =
    await SolanaStablecoin.create(connection, {
      ...Presets.SSS_1,
      name: "SDK Tutorial USD",
      symbol: "sUSD",
      uri: "",
      decimals: 6,
      authority: authority.publicKey,
    });

  const createTx = new Transaction().add(instruction);
  await sendAndConfirmTransaction(connection, createTx, [
    authority,
    mintKeypair,
  ]);
  console.log("Stablecoin created! Mint:", mintKeypair.publicKey.toBase58());

  // 3. Load the stablecoin (can also be used to reconnect later)
  const loaded = await SolanaStablecoin.load(
    connection,
    mintKeypair.publicKey
  );
  const config = await loaded.getConfig();
  console.log("Name:", config.name, "| Symbol:", config.symbol);

  // 4. Assign minter role and set quota using the builder API
  const updateRolesIx = await loaded.updateRoles({
    roleType: 0, // Minter
    user: authority.publicKey,
    active: true,
    authority: authority.publicKey,
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(updateRolesIx),
    [authority]
  );

  const updateMinterIx = await loaded.updateMinter({
    minter: authority.publicKey,
    quota: new BN("1000000000000"),
    authority: authority.publicKey,
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(updateMinterIx),
    [authority]
  );

  // 5. Mint 10,000 tokens using the fluent builder
  const recipient = Keypair.generate();
  await connection.confirmTransaction(
    await connection.requestAirdrop(recipient.publicKey, LAMPORTS_PER_SOL)
  );

  await loaded
    .mint(new BN(10_000_000_000))
    .to(recipient.publicKey)
    .by(authority)
    .createAccountIfNeeded()
    .send(authority);
  console.log("Minted 10,000 sUSD to", recipient.publicKey.toBase58());

  // 6. Check supply
  const supply = await loaded.getSupply();
  console.log("Total supply:", supply.toString());

  // 7. Burn tokens (assign burner role first)
  const burnerRoleIx = await loaded.updateRoles({
    roleType: 1, // Burner
    user: authority.publicKey,
    active: true,
    authority: authority.publicKey,
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(burnerRoleIx),
    [authority]
  );

  // Mint some to ourselves first, then burn
  await loaded
    .mint(new BN(5_000_000_000))
    .to(authority.publicKey)
    .by(authority)
    .createAccountIfNeeded()
    .send(authority);

  await loaded.burn(new BN(1_000_000_000)).by(authority).send(authority);
  console.log("Burned 1,000 sUSD");

  // 8. Batch operations — mint to multiple recipients at once
  const recipients = [Keypair.generate(), Keypair.generate()];
  for (const r of recipients) {
    await connection.confirmTransaction(
      await connection.requestAirdrop(r.publicKey, LAMPORTS_PER_SOL)
    );
  }

  await loaded
    .batchMint([
      { to: recipients[0].publicKey, amount: new BN(1_000_000_000) },
      { to: recipients[1].publicKey, amount: new BN(2_000_000_000) },
    ])
    .by(authority)
    .createAccountsIfNeeded()
    .send(authority);
  console.log("Batch minted to 2 recipients");

  console.log("Tutorial complete!");
}

main().catch(console.error);
```

### Using the fluent builder with retry and simulation

```typescript
// Mint with pre-flight simulation and automatic retry on transient failures
await stablecoin
  .mint(new BN(1_000_000))
  .to(recipient.publicKey)
  .by(minterKeypair)
  .withMemo("Monthly distribution")
  .withComputeBudget(200_000)
  .withRetry({ maxRetries: 3, initialDelayMs: 500 })
  .withSimulation()
  .send(payerKeypair);
```

### Parsing events from a transaction

```typescript
import { SSSEventParser, SSSEventName } from "@stbr/sss-core-sdk";

const parser = new SSSEventParser(program);

// Parse events from a transaction signature
const events = await parser.parseTransaction(connection, txSignature);

// Filter for mint events with full type safety
const mints = parser.filterEvents(events, SSSEventName.TokensMinted);
for (const mint of mints) {
  console.log(`Minted ${mint.data.amount} to config ${mint.data.config}`);
}

// Real-time WebSocket subscription
parser.addEventListener(connection, SSSEventName.TokensBurned, (event) => {
  console.log("Burn detected:", event.data.amount.toString());
});
```

For the full SDK API reference with 15 sections and 5 end-to-end workflows, see [docs/SDK.md](docs/SDK.md).

---

## Program IDs

### Devnet

| Program         | Address                                        |
| --------------- | ---------------------------------------------- |
| SSS             | `EaQk4dxh7MmvE3cL57Ns3QFqNKnfoCrxeVzFLSHajWFr` |
| Transfer Hook   | `EFui8Qo2RuojKfzfPCTzQjiSUAaHpiJ5qKwW6NXLbMAr` |
| Oracle          | `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ` |

### Localnet

| Program         | Address                                        |
| --------------- | ---------------------------------------------- |
| SSS             | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` |
| Transfer Hook   | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` |
| Oracle          | `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ` |

---

## SDK Usage

### Installation

```bash
yarn add @stbr/sss-core-sdk @stbr/sss-compliance-sdk
```

### Create a New Stablecoin

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-core-sdk";

// SSS-2 (compliant) stablecoin
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    ...Presets.SSS_2,
    name: "My USD",
    symbol: "MUSD",
    uri: "https://example.com/metadata.json",
    decimals: 6,
    authority: wallet.publicKey,
    transferHookProgramId: HOOK_PROGRAM_ID,
  }
);

const tx = new Transaction().add(instruction);
await sendAndConfirmTransaction(connection, tx, [wallet, mintKeypair]);
```

### Load and Operate

```typescript
const stablecoin = await SolanaStablecoin.load(connection, mintAddress);

// Mint tokens
const mintIx = await stablecoin.mint({
  amount: new BN(1_000_000),
  recipientTokenAccount: recipientAta,
  minter: minterKeypair.publicKey,
});

// Blacklist an address (SSS-2 only)
const blacklistIx = await stablecoin.compliance.blacklistAdd({
  address: suspiciousUser,
  reason: "Sanctions compliance",
  authority: blacklisterPubkey,
});

// Seize tokens (SSS-2 only)
const seizeIx = await stablecoin.compliance.seize({
  fromTokenAccount: targetAta,
  toTokenAccount: treasuryAta,
  amount: new BN(100_000),
  authority: seizerPubkey,
});
```

See [docs/SDK.md](docs/SDK.md) for the complete API reference.

---

## CLI Reference

The `sss-token` CLI wraps the SDK for terminal-based administration.

```bash
sss-token init          # Initialize a new stablecoin
sss-token roles assign  # Assign a role to a user
sss-token roles revoke  # Revoke a role from a user
sss-token minters add   # Set/update a minter quota
sss-token mint          # Mint tokens
sss-token burn          # Burn tokens
sss-token freeze        # Freeze a token account
sss-token thaw          # Thaw a frozen token account
sss-token pause         # Pause all minting and burning
sss-token unpause       # Resume operations
sss-token blacklist add # Add address to blacklist (SSS-2)
sss-token blacklist remove # Remove address from blacklist (SSS-2)
sss-token seize         # Seize tokens via permanent delegate (SSS-2)
sss-token status        # Display stablecoin configuration
sss-token supply        # Display supply information
```

---

## Oracle Integration Module

The oracle module provides [Switchboard V2](https://switchboard.xyz/) price feed integration for non-USD stablecoin pegs (EUR, BRL, CPI-indexed, etc.). It is a separate Anchor program that reads aggregator accounts and stores verified, bounds-checked prices on-chain.

### Architecture

```
Switchboard V2           Oracle Program            Backend / SDK
 Aggregator    ◄──reads── refresh_price ──stores──► OracleConfig PDA
 (EUR/USD,                                          (last_price,
  BRL/USD,                                           last_timestamp,
  CPI index)                                         bounds, staleness)
```

The oracle does not modify the SSS stablecoin program — it is a companion data provider. The backend or SDK reads the `OracleConfig` PDA to calculate mint/redeem amounts at the correct exchange rate.

### Instructions

| Instruction            | Description                                             | Auth           |
| ---------------------- | ------------------------------------------------------- | -------------- |
| `initialize_oracle`    | Create oracle config linked to stablecoin + aggregator  | Authority      |
| `update_oracle_config` | Update aggregator, thresholds, bounds                   | Authority      |
| `refresh_price`        | Read Switchboard aggregator, validate, store price      | Permissionless |
| `push_manual_price`    | Push price manually (testing/backup)                    | Authority      |

### Switchboard Integration

The oracle parses Switchboard V2 aggregator account data at known Borsh serialization offsets, extracting the `latest_confirmed_round.result` (mantissa + scale) and `round_open_timestamp`. This avoids a dependency on the full `switchboard-solana` SDK, keeping the BPF binary small. The program validates:

- **Staleness** — price data must be within the configured `staleness_threshold` seconds
- **Bounds** — price must fall within `[min_price, max_price]`
- **Positivity** — negative or zero prices are rejected

### SDK Usage

```typescript
import { OracleModule } from "@stbr/sss-core-sdk";

// Load oracle for an existing stablecoin
const oracle = await OracleModule.load(connection, stablecoinConfigAddress);

// Read the latest price
const price = await oracle.getPrice();
console.log(`1 token = ${price.formatted} ${price.baseCurrency}`);

// Convert: how many tokens for 100 BRL?
const tokens = oracle.fiatToTokens(100, 6); // 6 = token decimals
```

---

## Admin TUI Dashboard

An interactive terminal dashboard built with [ratatui](https://ratatui.rs) for real-time monitoring of your stablecoin.

```bash
# Build the TUI
cd tui && cargo build --release

# Launch (connects to local validator by default)
./target/release/sss-admin-tui --mint <MINT_ADDRESS>

# Connect to devnet
./target/release/sss-admin-tui --rpc https://api.devnet.solana.com --mint <MINT_ADDRESS>

# Custom program ID and refresh interval
./target/release/sss-admin-tui --mint <MINT> --program-id <PROGRAM_ID> --refresh-interval 10
```

**Features:**
- **Dashboard** — Live supply metrics (minted/burned/net/on-chain), preset badge (SSS-1/SSS-2), pause status, feature flags, circulation gauge
- **Roles** — All role assignments with address, type, and active/inactive status
- **Minters** — Quota usage with progress bars and color-coded utilization (green <50%, yellow 50-90%, red >90%)
- **Blacklist** — Entries with reason, timestamp, and authority (SSS-2 only)
- **Help** — Keyboard shortcuts reference

**Navigation:** `Tab`/`Shift+Tab` to switch tabs, `1-5` for direct access, `↑↓`/`jk` to navigate lists, `r` to refresh, `q` to quit.

Data auto-refreshes every 5 seconds from the Solana RPC. Environment variables `RPC_URL`, `SSS_MINT_ADDRESS`, and `SSS_PROGRAM_ID` are also supported.

---

## Admin Frontend (Next.js)

A web-based admin panel built with [Next.js 14](https://nextjs.org/) for managing stablecoin operations through a browser UI.

```bash
# Install dependencies
cd frontend && yarn install

# Start development server
yarn dev    # → http://localhost:3000

# Build for production
yarn build && yarn start
```

**Features:**
- **Dashboard** — Supply overview, token identity, addresses, feature flags, preset badge, pause status
- **Mint & Burn** — Forms for minting tokens to any wallet and burning from token accounts
- **Roles** — View all role assignments, assign/revoke roles, manage minter quotas with usage gauges
- **Freeze & Thaw** — Freeze or thaw any wallet's associated token account
- **Blacklist** — Add/remove addresses from the on-chain blacklist with reasons (SSS-2 only)
- **Pause Control** — Pause/unpause the stablecoin with confirmation safety prompt

**Stack:** Next.js 14, Tailwind CSS, `@solana/wallet-adapter`, `@coral-xyz/anchor`. Connects to the on-chain program directly via Anchor IDL — no backend dependency required.

**Usage:** Connect your wallet (Phantom, Solflare, etc.), enter a mint address, and start managing. Works on localnet, devnet, and mainnet.

---

## Backend API

The backend is a Rust/Axum REST API with PostgreSQL, providing programmatic access to all stablecoin operations.

```bash
# Start with Docker Compose
cd backend && docker compose up --build

# The API is available at http://localhost:3001
```

Key endpoints:

| Method   | Endpoint                    | Description                  |
| -------- | --------------------------- | ---------------------------- |
| `GET`    | `/health`                   | Health check                 |
| `POST`   | `/api/v1/mint`              | Queue a mint operation       |
| `POST`   | `/api/v1/burn`              | Queue a burn operation       |
| `POST`   | `/api/v1/blacklist`         | Add address to blacklist     |
| `DELETE` | `/api/v1/blacklist/{addr}`  | Remove address from blacklist|
| `GET`    | `/api/v1/blacklist`         | List all blacklisted addresses|
| `GET`    | `/api/v1/audit`             | Query the audit log          |
| `POST`   | `/api/v1/webhooks`          | Register a webhook listener  |

All `/api/v1/*` endpoints require an API key via the `X-API-Key` header. See [docs/API.md](docs/API.md) for the full API reference.

---

## Documentation

| Document                                   | Description                                  |
| ------------------------------------------ | -------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)       | System design, PDA layout, security model    |
| [SSS-1 Spec](docs/SSS-1.md)               | Minimal stablecoin standard specification    |
| [SSS-2 Spec](docs/SSS-2.md)               | Compliant stablecoin standard specification  |
| [SDK Reference](docs/SDK.md)              | TypeScript SDK API and usage examples        |
| [Operations Runbook](docs/OPERATIONS.md)  | Step-by-step guide for every operation       |
| [Compliance Guide](docs/COMPLIANCE.md)    | Regulatory considerations and audit trail    |
| [API Reference](docs/API.md)             | Backend REST API documentation               |

---

## Security Model

SSS enforces security at multiple levels:

- **Role-based access control** -- Five distinct role types, each stored as a separate PDA. The master authority assigns and revokes roles. No arrays are used, so the system scales to unlimited role holders without account size concerns.
- **Feature gating** -- SSS-2 instructions check `config.enable_transfer_hook` and `config.enable_permanent_delegate` on-chain and fail with `ComplianceNotEnabled` if the config does not support them. These flags are immutable after initialization, so users know at mint creation time what capabilities the issuer has.
- **Checked arithmetic** -- All `u64` operations use `checked_add` / `checked_sub` to prevent overflow.
- **PDA authority** -- The config PDA is the mint authority, freeze authority, and permanent delegate. All token operations go through the program via CPI with PDA signer seeds. No private key controls the mint.
- **Bump storage** -- PDA bumps are stored in account state and never recalculated, preventing bump manipulation.
- **Transfer hook enforcement** -- Blacklist checks happen at the Token-2022 level on every `transfer_checked`, making them impossible to bypass by any client.

---

## Regulatory Alignment

SSS-2 is designed with current and proposed regulatory frameworks in mind:

- **Sanctions / OFAC compliance** -- On-chain blacklist with transfer hook enforcement blocks sanctioned addresses from sending or receiving tokens at the protocol level.
- **Anti-money laundering (AML)** -- Suspicious addresses identified through off-chain monitoring can be blacklisted; frozen accounts prevent movement during investigations.
- **Court-ordered asset recovery** -- The seize function enables regulator-mandated recovery without the token holder's signature.
- **GENIUS Act alignment** -- Issuer controls, sanctions enforcement, asset recovery, transparency (all operations emit events), and interoperability with the Solana ecosystem.
- **Full audit trail** -- Every operation emits an on-chain event with the actor, action, amount, and timestamp for compliance reporting.

---

## Contributing

Contributions are welcome. Please follow these guidelines:

1. Fork the repository and create a feature branch from `main`.
2. Run `anchor build` and `anchor test` to make sure nothing is broken.
3. Write clear commit messages explaining **why** the change was made.
4. Open a pull request with a description of the change and any relevant context.
5. All pull requests require at least one approval before merging.

For larger features or protocol changes, please open an issue first to discuss the design.

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Superteam Brazil.
