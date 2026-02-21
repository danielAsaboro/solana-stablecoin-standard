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
- [Program IDs](#program-ids)
- [SDK Usage](#sdk-usage)
- [CLI Reference](#cli-reference)
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

## Program IDs

### Devnet

| Program         | Address                                        |
| --------------- | ---------------------------------------------- |
| SSS             | `EaQk4dxh7MmvE3cL57Ns3QFqNKnfoCrxeVzFLSHajWFr` |
| Transfer Hook   | `EFui8Qo2RuojKfzfPCTzQjiSUAaHpiJ5qKwW6NXLbMAr` |

### Localnet

| Program         | Address                                        |
| --------------- | ---------------------------------------------- |
| SSS             | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` |
| Transfer Hook   | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` |

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
