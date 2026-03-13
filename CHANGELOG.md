# Changelog

All notable changes to the Solana Stablecoin Standard (SSS) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.1] - 2026-03-01

Polish pass ahead of bounty submission: CLI fix, frontend feature, and documentation improvements.

### Fixed

- **`sss-token minters list`** — address argument is now optional. Calling `minters list` with no argument enumerates all `MinterQuota` PDAs for the stablecoin via `getProgramAccounts` and prints a quota table. Passing an address still shows info for that specific minter.

### Added

- **Seize component** (`frontend/src/components/Seize.tsx`) — New admin UI panel for SSS-2 token seizure. Form accepts target wallet, treasury wallet, and amount; gates on `enablePermanentDelegate`; emits a compliance notice.
- **`seizeTokens` hook method** (`frontend/src/hooks/useStablecoin.ts`) — Exposes the on-chain `seize` instruction through the React hook, computing ATAs from owner addresses automatically.

### Documentation

- `docs/API.md` — Added Storage Model section explaining that the backend is stateless by design; on-chain events are the authoritative audit trail.
- `README.md` — Added CI badge at the top; added Localnet Testing Note under Oracle Integration explaining that `push_manual_price` is the localnet test path and documenting how to use a real Switchboard aggregator on devnet/mainnet.

## [0.3.0] - 2026-02-23

SDK polish, CI/CD, and bounty spec alignment.

### Added

- **`@stbr/sss-token` package** (`sdk/token/`) — canonical consumer entrypoint matching the bounty specification. Thin wrapper that re-exports everything from `@stbr/sss-core-sdk`. Allows `import { SolanaStablecoin, Presets } from "@stbr/sss-token"` to work exactly as shown in the bounty spec.
- **GitHub Actions CI** (`.github/workflows/ci.yml`) — 5-job CI pipeline:
  - `typescript`: `yarn build` (SDK + CLI) on Node 20
  - `backend`: `cargo build && cargo test` (53 integration tests)
  - `fuzz-tests`: `cargo test` (21 proptest cases, ~11,800 randomized checks)
  - `anchor-build`: Full Anchor programs build (Solana v1.18.26 + Anchor v0.32.1)
  - `lint`: Clippy on backend and trident-tests with `-D warnings`
- **Convenience re-exports** in `@stbr/sss-core-sdk` — `BN` (from `@coral-xyz/anchor`) and `PublicKey`, `Keypair` (from `@solana/web3.js`) re-exported from the SDK index. Pattern follows the Solana Vault Standard (SVS) reference repo. Consumers no longer need separate imports for these primitives.
- `"license": "MIT"` field added to all `package.json` files (zero `yarn build` warnings now)

### Improved

- `README.md` — Updated TypeScript SDK install example to use `@stbr/sss-token`; added `@stbr/sss-token` install command with explanation note
- `docs/SDK.md` — Updated Quick Start import to `@stbr/sss-token` with `// or: @stbr/sss-core-sdk (underlying implementation)` comment

## [0.2.0] - 2026-02-23

Quality and documentation improvements based on post-release review.

### Added

- 4 new integration tests for role concurrency and SSS-2 compliance role gating (`tests/roles.ts`: 4 → 6 tests)
- 2 new integration tests for seize security: unauthorized seize rejection, full-balance seize (`tests/seize.ts`: 2 → 4 tests)
- **Total tests: 170** (96 Anchor + 53 Backend + 21 Fuzz), up from 166

### Improved

- **`docs/SSS-1.md`** — Expanded from 63 to 1,124 lines: EIP-style metadata, complete account layout (all 17 fields with byte sizes), PDA derivation with TypeScript examples, all 10 instructions fully specified with accounts tables, validation rules, state changes, emitted events, error codes; role system deep-dive, quota mechanics, 13 security invariants, SDK examples
- **`docs/SSS-2.md`** — Expanded from 89 to 1,204 lines: complete transfer hook program specification (extra account resolution with 9 indexed accounts, seizure bypass mechanics), full compliance lifecycle (blacklist PDA lifecycle, enforcement coverage, audit trail), regulatory alignment section (OFAC SDN, GENIUS Act, court orders), step-by-step initialization guide with TypeScript code
- **`docs/API.md`** — Rewritten with all 20 REST endpoints documented accurately: correct response shapes, status codes, operation lifecycle (Pending → Executing → Completed/Failed), accurate env vars (`RPC_URL`, `SSS_API_KEY`), removed stale postgres references
- **`docs/ARCHITECTURE.md`** — Added all 4 programs (SSS, Transfer Hook, Oracle, Privacy), complete PDA table with Preset column, all 5 Token-2022 extensions, program IDs table for all 4 programs
- **`docs/COMPLIANCE.md`** — Fixed 5 incorrect event names to match actual Anchor event structs
- **`docs/TESTING.md`** — Updated test pyramid, per-file breakdowns, and coverage table to reflect all 9 test files with accurate counts

### Fixed

- All test count references corrected across `README.md`, `TESTING.md`, `DEVNET_DEPLOYMENT.md` (was 81/155, corrected to accurate counts)

## [0.1.0] - 2026-02-22

Initial release of the Solana Stablecoin Standard — a modular stablecoin toolkit for Solana
with three presets: SSS-1 (Minimal Stablecoin), SSS-2 (Compliant Stablecoin), and SSS-3 (Privacy Stablecoin).

### SSS-3 Privacy Stablecoin (Experimental)

- Added `enable_confidential_transfer` flag to `StablecoinConfig` (uses 1 byte from `_reserved`)
- SSS program conditionally enables `ConfidentialTransferMint` Token-2022 extension during initialization
- New Privacy companion program (`programs/privacy/`) with 4 instructions:
  - `initialize_privacy` — create privacy config linked to stablecoin
  - `update_privacy_config` — update auto-approve setting
  - `add_to_allowlist` — add address to confidential transfer allowlist
  - `remove_from_allowlist` — remove address from allowlist
- `PrivacyConfig` PDA: `["privacy_config", stablecoin_config]`
- `AllowlistEntry` PDA: `["allowlist", privacy_config, address]`
- New `SSS_3` preset in SDK: confidential transfers enabled, no compliance features
- New `PrivacyModule` SDK class with read/write methods for allowlist management
- PDA helpers: `getPrivacyConfigAddress()`, `getAllowlistEntryAddress()`
- Comprehensive SSS-3 specification in `docs/SSS-3.md`

### Added

#### On-Chain Programs
- **SSS Program** (`programs/sss/`) — Anchor program (Token-2022) with 13 instructions:
  `initialize`, `mint_tokens`, `burn_tokens`, `freeze_account`, `thaw_account`,
  `pause`, `unpause`, `update_roles`, `update_minter`, `transfer_authority`,
  `add_to_blacklist`, `remove_from_blacklist`, `seize`
- **Transfer Hook Program** (`programs/transfer-hook/`) — SPL Transfer Hook enforcing
  blacklist checks on every token transfer with seizure bypass logic
- Role-based access control with 5 role types: Minter, Burner, Pauser, Blacklister, Seizer
- Per-minter quota system with cumulative tracking and checked arithmetic
- Feature-gated SSS-2 instructions (permanent delegate + transfer hook) that fail
  gracefully on SSS-1 configurations
- Comprehensive event emission on all 13 instructions for full audit trail
- `#![deny(clippy::all)]` enforcement with zero warnings on both programs

#### TypeScript SDK (`@stbr/sss-core-sdk`)
- `SolanaStablecoin` class with preset-based initialization (SSS-1, SSS-2, Custom)
- Fluent builder API for all operations — chain `.to()`, `.by()`, `.withMemo()`,
  `.withComputeBudget()`, `.withPriorityFee()`, `.send()` for every instruction
- Batch operations — `BatchMintBuilder`, `BatchBurnBuilder`, `BatchFreezeBuilder`,
  `BatchThawBuilder`, and general-purpose `BatchBuilder` for atomic multi-operation
  transactions
- Strongly-typed event parsing — `SSSEventParser` with discriminated union types,
  WebSocket subscriptions, and type-safe filtering via `filterEvents()`
- Retry logic with exponential backoff — `withRetry()` standalone utility and
  `.withRetry()` builder method with transient error classification and jitter
- Transaction simulation — `.withSimulation()` pre-flight validation, `.dryRun()`
  non-throwing inspection, and `simulateTransaction()` with human-readable error
  parsing for all 45+ error codes across SSS, Transfer Hook, Anchor, and Token programs
- PDA derivation helpers for all 5 PDA types (Config, Role, MinterQuota,
  BlacklistEntry, ExtraAccountMetas)
- Comprehensive JSDoc/TSDoc on all public APIs with `@example`, `@param`, `@returns`,
  and `@see` tags

#### Compliance SDK (`@stbr/sss-compliance-sdk`)
- `ComplianceModule` with `BlacklistManager` and `AuditLog` components
- Blacklist PDA derivation and on-chain status queries
- Audit log with filtering by action type, address, and time range
- Full JSDoc documentation on all public interfaces

#### Admin CLI (`@stbr/sss-cli`)
- 12 subcommands: `init`, `mint`, `burn`, `freeze`, `pause`, `blacklist`, `seize`,
  `minters`, `roles`, `status`, `holders`, `audit-log`
- Preset initialization: `sss-token init --preset sss-1` / `--preset sss-2`
- Full stablecoin state dashboard via `status` command — supply, authorities, roles,
  minter quotas with usage bars, blacklist count, and preset badge
- `holders` command — list all token holders with balances, `--min-balance` filter,
  sorting by balance or address, percentage of total supply per holder
- `audit-log` command — query on-chain event history with `--action` filter
  (mint, burn, freeze, blacklist, seize, etc.), Anchor event log parsing,
  pagination support via `--before` signature
- Terminal spinners (ora) during all RPC operations
- Solana Explorer links after every transaction (auto-detects cluster)
- Formatted output with color-coded status badges

#### Backend API (`backend/`)
- Rust/Axum REST API with Docker Compose support
- **MintBurnService** — real Solana RPC integration for on-chain mint/burn operations
  with Anchor-compatible instruction building (discriminators, Borsh serialization)
- **ComplianceService** — on-chain blacklist management (add, remove, check) with
  audit log tracking
- **IndexerService** — background polling of on-chain events with Anchor event log
  parsing (base64 decode, 8-byte discriminator matching, Borsh deserialization for
  all 13 event types)
- **WebhookService** — configurable webhook endpoints with event type filtering,
  HMAC-SHA256 signature verification, and retry with exponential backoff
- Health check endpoint with per-service availability reporting
- Typed error handling (`AppError` enum) with proper HTTP status codes
- Structured logging via `tracing`
- Environment-based configuration with `.env.example`

#### Example Frontend (`frontend/`)
- Next.js 14 admin panel for web-based stablecoin management
- Wallet adapter integration (Phantom, Solflare, any Solana wallet)
- 6 views: Dashboard, Mint & Burn, Roles, Freeze & Thaw, Blacklist, Pause Control
- Dashboard with supply metrics, token identity, feature flags, preset badge, pause status
- Real-time data from on-chain program via Anchor IDL (no backend dependency)
- Role management with assign/revoke forms and minter quota usage visualization
- Blacklist management with add/remove forms and entry table (SSS-2 only)
- Pause control with confirmation safety prompt (must type symbol to confirm)
- Tailwind CSS dark theme with professional styling
- Custom `useStablecoin` React hook encapsulating all program interactions

#### Oracle Integration Module (`programs/oracle/`)
- Separate Anchor program for Switchboard V2 price feed integration
- 4 instructions: `initialize_oracle`, `update_oracle_config`, `refresh_price`,
  `push_manual_price`
- Direct Switchboard V2 aggregator data parsing at known Borsh byte offsets —
  no heavy `switchboard-solana` SDK dependency
- Staleness validation, price bounds checking, positive price enforcement
- Permissionless cranking for `refresh_price` (any signer can update the price)
- Manual price override mode for testing, development, and fallback scenarios
- 4 events: `OracleInitialized`, `OracleConfigUpdated`, `PriceRefreshed`,
  `ManualPricePushed`
- SDK `OracleModule` class with price reading, amount conversion (`fiatToTokens`,
  `tokensToFiat`), and instruction builders
- `#![deny(clippy::all)]` enforcement with zero warnings
- Comprehensive `///` doc comments on all public items

#### Interactive Admin TUI (`tui/`)
- Standalone `sss-admin-tui` binary built with [ratatui](https://ratatui.rs) + crossterm
- 5-tab terminal dashboard: Dashboard, Roles, Minters, Blacklist, Help
- Live supply metrics (total minted, burned, net, on-chain Token-2022 supply)
- Preset auto-detection badge (SSS-1 / SSS-2 / Custom)
- Role table with active/inactive status and per-user grouping
- Minter quota gauges with color-coded utilization (green/yellow/red)
- Blacklist entry table with reason, timestamp, and authority (SSS-2 only)
- Circulation gauge (net supply / total minted ratio)
- Background data polling via background thread (configurable interval, default 5s)
- Borsh deserialization of all 4 Anchor account types (Config, Role, MinterQuota, BlacklistEntry)
- Direct Token-2022 mint supply parsing (no `spl-token-2022` dependency needed)
- CLI args via clap: `--rpc`, `--mint`, `--program-id`, `--refresh-interval`
- Environment variable support: `RPC_URL`, `SSS_MINT_ADDRESS`, `SSS_PROGRAM_ID`
- Zero clippy warnings

#### Tests
- 81 Anchor integration tests:
  - 34 core tests covering SSS-1 and SSS-2 full instruction sets
  - 20 edge case tests (zero amounts, max u64 overflow, duplicate blacklist,
    role self-revocation, pause state guards, input validation)
  - 31 authority rotation lifecycle tests (A→B→C→A chain transfer with role
    persistence and revocation verification)
- 53 backend integration tests:
  - HTTP route testing for all endpoints (health, mint/burn, compliance, webhooks,
    indexer)
  - Webhook dispatch verification with wiremock (HMAC signatures, retry behavior,
    event filtering)
  - PDA derivation determinism and instruction builder correctness
  - Service unavailability (503) testing for graceful degradation

#### Security
- `SECURITY_AUDIT.md` — 13-section audit document covering threat model, access
  control matrix, PDA validation, account constraints, arithmetic safety, CPI
  security, reentrancy analysis, feature gating, transfer hook security, input
  validation, event emission, known limitations, and deployment checklist
- All token account parameters upgraded from `AccountInfo` with `/// CHECK:` to
  `InterfaceAccount<TokenAccount>` with explicit `token::mint` + `token::token_program`
  constraints
- Checked arithmetic everywhere — 6 runtime `checked_add` operations, 2 safe type
  casts, zero unchecked math
- Zero `unwrap()` in production code

#### Documentation
- `README.md` — Overview, quick start, architecture, and 3 end-to-end tutorials
  (SSS-1 CLI, SSS-2 CLI, TypeScript SDK)
- `docs/ARCHITECTURE.md` — Layer model, data flows, security model
- `docs/SDK.md` — 15-section SDK reference with copy-pasteable examples for all
  operations (params API, builder API, batch, events, retry, simulation, compliance)
- `docs/SSS-1.md` — Minimal Stablecoin standard specification
- `docs/SSS-2.md` — Compliant Stablecoin standard specification
- `docs/OPERATIONS.md` — Operator runbook for all stablecoin operations
- `docs/COMPLIANCE.md` — Regulatory considerations and audit trail format
- `docs/API.md` — Backend REST API reference
- `docs/SECURITY_AUDIT.md` — Comprehensive security audit checklist
- `docs/TESTING.md` — Test pyramid, categories, fuzz documentation, helper patterns
- `docs/DEVNET_DEPLOYMENT.md` — Devnet deployment guide with automated scripts,
  example transactions, program IDs, and troubleshooting

#### Deployment Automation
- `scripts/deploy-devnet.sh` — Automated shell script for full devnet deployment
  (builds, deploys 4 programs, runs demos, captures tx signatures, Explorer links)
- `scripts/deploy-devnet.ts` — SSS-1 demo script exercising all 8 core operations
  (init, roles, quota, mint, burn, freeze/thaw, pause/unpause) with tx signatures
  and Explorer links output
- `scripts/deploy-sss2-devnet.ts` — SSS-2 compliance demo script exercising full
  lifecycle (init, hook setup, 5 roles, mint, blacklist, seize via permanent delegate
  with transfer hook extra account resolution, unblacklist) with tx signatures output

[0.1.0]: https://github.com/solanabr/solana-stablecoin-standard/releases/tag/v0.1.0
