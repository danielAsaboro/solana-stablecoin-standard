# Changelog

All notable changes to the Solana Stablecoin Standard (SSS) will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- 10 subcommands: `init`, `mint`, `burn`, `freeze`, `pause`, `blacklist`, `seize`,
  `minters`, `roles`, `status`
- Preset initialization: `sss-token init --preset sss-1` / `--preset sss-2`
- Full stablecoin state dashboard via `status` command — supply, authorities, roles,
  minter quotas with usage bars, blacklist count, and preset badge
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
- `docs/DEVNET_DEPLOYMENT.md` — Devnet deployment guide with automated scripts,
  example transactions, program IDs, and troubleshooting

#### Deployment Automation
- `scripts/deploy-devnet.sh` — Automated shell script for full devnet deployment
  (builds, deploys 3 programs, runs demos, captures tx signatures, Explorer links)
- `scripts/deploy-devnet.ts` — SSS-1 demo script exercising all 8 core operations
  (init, roles, quota, mint, burn, freeze/thaw, pause/unpause) with tx signatures
  and Explorer links output
- `scripts/deploy-sss2-devnet.ts` — SSS-2 compliance demo script exercising full
  lifecycle (init, hook setup, 5 roles, mint, blacklist, seize via permanent delegate
  with transfer hook extra account resolution, unblacklist) with tx signatures output

[0.1.0]: https://github.com/solanabr/solana-stablecoin-standard/releases/tag/v0.1.0
