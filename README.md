# Solana Stablecoin Standard (SSS)

[![CI](https://github.com/solanabr/solana-stablecoin-standard/actions/workflows/ci.yml/badge.svg)](https://github.com/solanabr/solana-stablecoin-standard/actions/workflows/ci.yml)

> A modular, open-source framework for launching regulated stablecoins on Solana using the Token-2022 program.

SSS provides three preset configurations -- **SSS-1** (minimal), **SSS-2** (compliant), and **SSS-3** (privacy) -- so that issuers can go from zero to a fully operational stablecoin in minutes rather than months. Built on Anchor and Token-2022, it packages battle-tested patterns for role-based access control, mint quotas, on-chain blacklist enforcement, forced seizure, and confidential transfers into a single cohesive toolkit.

---

## Preset Comparison

| Feature                          | SSS-1 (Minimal) | SSS-2 (Compliant) | SSS-3 (Privacy) |
| -------------------------------- | :--------------: | :----------------: | :--------------: |
| Token-2022 Mint                  |        Y         |         Y          |        Y         |
| On-chain Metadata                |        Y         |         Y          |        Y         |
| Role-based Access Control        |        Y         |         Y          |        Y         |
| Mint / Burn with Quotas          |        Y         |         Y          |        Y         |
| Pause / Unpause                  |        Y         |         Y          |        Y         |
| Freeze / Thaw Accounts           |        Y         |         Y          |        Y         |
| Two-step Authority Transfer      |        Y         |         Y          |        Y         |
| Permanent Delegate (Seize)       |                  |         Y          |                  |
| Transfer Hook (Blacklist)        |                  |         Y          |                  |
| On-chain Blacklist PDAs          |                  |         Y          |                  |
| ConfidentialTransferMint Ext.    |                  |                    |        Y         |
| Privacy Allowlist (companion)    |                  |                    |        Y         |

See [docs/SSS-1.md](docs/SSS-1.md), [docs/SSS-2.md](docs/SSS-2.md), and [docs/SSS-3.md](docs/SSS-3.md) for the full specifications.

---

## Architecture

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
| PrivacyConfig       | `["privacy_config", stablecoin_config]` | Privacy       |

For the full architecture document, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/solanabr/solana-stablecoin-standard.git
cd solana-stablecoin-standard
npm install

# Build everything
npm run build

# Run the full test suite
npm test
```

### Launch an SSS-2 stablecoin (CLI)

```bash
sss-token init --preset sss-2 --name "Compliant USD" --symbol cUSD --decimals 6
sss-token minters add $(solana address) --quota 1000000000000
sss-token mint $(solana address) 10000000000
sss-token blacklist add <ADDRESS> --reason "OFAC SDN match"
sss-token seize <ADDRESS> --to <TREASURY> --amount 10000000000
```

### Launch via TypeScript SDK

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-token";

const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  { ...Presets.SSS_2, name: "My USD", symbol: "MUSD", decimals: 6, authority: wallet.publicKey }
);
```

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for the full operations runbook and step-by-step tutorials.

---

## Program IDs

### Devnet (Live)

| Program         | Address                                        | Explorer |
| --------------- | ---------------------------------------------- | -------- |
| SSS             | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` | [View](https://explorer.solana.com/address/DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu?cluster=devnet) |
| Transfer Hook   | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` | [View](https://explorer.solana.com/address/Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH?cluster=devnet) |
| Oracle          | `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ` | [View](https://explorer.solana.com/address/6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ?cluster=devnet) |
| Privacy         | `Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk` | [View](https://explorer.solana.com/address/Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk?cluster=devnet) |

### Localnet

| Program         | Address                                        |
| --------------- | ---------------------------------------------- |
| SSS             | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` |
| Transfer Hook   | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` |
| Oracle          | `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ` |
| Privacy         | `Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk` |

---

## Build and Test

```bash
npm run build             # Build programs + SDK + CLI
npm test                  # Full test suite (starts Surfpool automatically)
npm run test:anchor       # Anchor integration tests only
npm run test:sdk          # SDK unit tests (58 tests)
npm run test:cli          # CLI smoke tests (17 tests)
```

### Test Coverage

| Suite | Count | Command |
|-------|------:|---------|
| Anchor integration | 190 | `anchor test --skip-build --skip-deploy --skip-local-validator` |
| LiteSVM (Rust) | 52 | `cargo test --manifest-path tests/litesvm/Cargo.toml` |
| SDK unit tests | 58 | `npm run test:sdk` |
| CLI smoke tests | 17 | `npm run test:cli` |
| Backend (Rust) | 67 | `cargo test --manifest-path backend/Cargo.toml` |
| Fuzz (Trident) | 28 | `cargo test --manifest-path trident-tests/Cargo.toml` |
| **Total** | **412** | |

---

## Repository Layout

```
programs/
  sss/               Core stablecoin program (Token-2022, roles, quotas, compliance)
  transfer-hook/     Blacklist enforcement hook (SPL Transfer Hook Interface)
  oracle/            Switchboard V2 price feed integration
  privacy/           Confidential transfer allowlist management (SSS-3)
  sss-math/          Shared checked arithmetic library
sdk/
  core/              @stbr/sss-core-sdk -- TypeScript SDK
  compliance/        @stbr/sss-compliance-sdk -- compliance extensions
cli/                 sss-token CLI tool (Commander.js)
backend/             Rust/Axum REST API with Docker
frontend/            Next.js admin dashboard
tui/                 Terminal UI (ratatui)
tests/               Anchor integration tests
trident-tests/       Fuzz and invariant tests
docs/                Specifications, architecture, guides
```

---

## CLI Reference

```bash
sss-token init              Initialize a new stablecoin (--preset sss-1 | sss-2)
sss-token status            Display stablecoin configuration and flags
sss-token supply            Display supply statistics
sss-token roles add/remove  Assign or revoke a role
sss-token minters add       Set/update a minter quota
sss-token mint              Mint tokens to a recipient
sss-token burn              Burn tokens from own account
sss-token freeze/thaw       Freeze or thaw a token account
sss-token pause/unpause     Pause or resume all operations
sss-token blacklist add     Add address to blacklist (SSS-2)
sss-token blacklist remove  Remove address from blacklist (SSS-2)
sss-token seize             Seize tokens via permanent delegate (SSS-2)
sss-token holders           List all token holders with balances
sss-token audit-log         Query on-chain event history
sss-token config show       Show local CLI config
sss-token --dry-run ...     Preview supported write actions
sss-token --output json     Machine-readable output
```

---

## SDK Usage

```bash
npm install @stbr/sss-token
```

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-token";

// Create stablecoin
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(connection, {
  ...Presets.SSS_2, name: "My USD", symbol: "MUSD", decimals: 6, authority: wallet.publicKey,
  transferHookProgramId: HOOK_PROGRAM_ID,
});

// Fluent builder API
await stablecoin.mint(new BN(10_000_000_000)).to(recipient).by(minter).send(payer);

// Compliance operations (SSS-2)
await stablecoin.compliance.blacklistAdd({ address: target, reason: "OFAC", authority });
await stablecoin.compliance.seize({ from: targetAta, to: treasuryAta, amount, authority });

// Event parsing
const events = await parser.parseTransaction(connection, txSignature);
```

See [docs/SDK.md](docs/SDK.md) for the complete API reference.

---

## Backend API

Rust/Axum REST API for programmatic access:

```bash
cd backend && cargo run          # Local development
docker compose up --build        # Docker deployment
```

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/api/v1/mint` | Queue a mint operation |
| `POST` | `/api/v1/burn` | Queue a burn operation |
| `POST` | `/api/v1/blacklist` | Add address to blacklist |
| `GET` | `/api/v1/blacklist` | List blacklisted addresses |
| `GET` | `/api/v1/audit` | Query the audit log |
| `POST` | `/api/v1/webhooks` | Register a webhook listener |

See [docs/API.md](docs/API.md) for the full API reference.

---

## Security Model

- **Role-based access control** -- Five distinct role types (Minter, Burner, Pauser, Blacklister, Seizer), each stored as a separate PDA. Scales to unlimited role holders.
- **Feature gating** -- SSS-2 instructions check `config.enable_transfer_hook` and `config.enable_permanent_delegate` on-chain. These flags are immutable after initialization.
- **Checked arithmetic** -- All `u64` operations use `checked_add` / `checked_sub`.
- **PDA authority** -- Config PDA is the mint authority, freeze authority, and permanent delegate. No private key controls the mint.
- **Transfer hook enforcement** -- Blacklist checks at the Token-2022 level on every `transfer_checked`, impossible to bypass.
- **Two-step authority transfer** -- Propose then accept, preventing accidental or malicious single-step transfers.

---

## Regulatory Alignment

| GENIUS Act Requirement | SSS Feature | Preset |
|----------------------|-------------|--------|
| Asset freeze capability | `freeze` instruction | SSS-1+ |
| Authorized minting | Role-based minting with quotas | SSS-1+ |
| Pause mechanism | `pause`/`unpause` instructions | SSS-1+ |
| Sanctions compliance | Blacklist + transfer hook enforcement | SSS-2 |
| Asset seizure (court order) | `seize` via permanent delegate | SSS-2 |
| Authority transfer controls | Two-step propose/accept | SSS-1+ |
| Transaction monitoring | Event emission on all state changes | SSS-1+ |
| Privacy (AML-compatible) | Confidential transfers with auditor key | SSS-3 |

---

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, PDA layout, security model |
| [SSS-1 Spec](docs/SSS-1.md) | Minimal stablecoin standard |
| [SSS-2 Spec](docs/SSS-2.md) | Compliant stablecoin standard |
| [SSS-3 Spec](docs/SSS-3.md) | Privacy stablecoin standard |
| [SDK Reference](docs/SDK.md) | TypeScript SDK API |
| [Operations Runbook](docs/OPERATIONS.md) | Step-by-step guide for every operation |
| [API Reference](docs/API.md) | Backend REST API |
| [Devnet Deployment](docs/DEVNET_DEPLOYMENT.md) | Program IDs, tx signatures, Explorer links |
| [Testing Guide](docs/TESTING.md) | Test pyramid, fuzz tests |
| [Security Checklist](docs/SECURITY_CHECKLIST.md) | Internal security review checklist |
| [GENIUS Act Mapping](docs/GENIUS-ACT.md) | Regulatory alignment |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites, workflow, code standards, and security rules.

---

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Superteam Brazil.
