# Architecture

## Three-Layer Model

```
Layer 3: Applications (CLI, Frontend, Backend API)
Layer 2: TypeScript SDK (@stbr/sss-core-sdk, @stbr/sss-compliance-sdk)
Layer 1: On-chain Programs (sss, transfer-hook)
```

### Layer 1 — On-Chain Programs

Two Anchor programs deployed on Solana:

**SSS Program** — Core stablecoin logic. Creates a Token-2022 mint with optional extensions, manages roles, quotas, and compliance operations. The config PDA owns the mint authority, freeze authority, and permanent delegate.

**Transfer Hook Program** — Implements the SPL Transfer Hook Interface. On every `transfer_checked`, Token-2022 CPIs into this program which checks BlacklistEntry PDAs for the source and destination owners. If either is blacklisted, the transfer is rejected.

### Layer 2 — TypeScript SDK

**@stbr/sss-core-sdk** — `SolanaStablecoin` class with static factories (`create`, `load`), instruction builders for all operations, PDA derivation helpers, and preset configurations.

**@stbr/sss-compliance-sdk** — `ComplianceModule` with blacklist management, `BlacklistManager` for querying blacklist state, and `AuditLog` for transaction history analysis.

### Layer 3 — Applications

**CLI** (`sss-token`) — Commander.js CLI wrapping the SDK for terminal-based administration.

**Backend** (Rust/Axum) — REST API for programmatic access with API key auth, operation lifecycle management, and webhook notifications.

## PDA Layout

| Account | Seeds | Program |
|---------|-------|---------|
| StablecoinConfig | `["stablecoin", mint]` | SSS |
| RoleAccount | `["role", config, role_type_u8, user]` | SSS |
| MinterQuota | `["minter_quota", config, minter]` | SSS |
| BlacklistEntry | `["blacklist", config, address]` | SSS |
| ExtraAccountMetas | `["extra-account-metas", mint]` | Transfer Hook |

## Data Flow

### Mint Flow
```
Minter → SDK.mint() → SSS Program
  1. Verify Minter role (RoleAccount PDA)
  2. Check quota (MinterQuota PDA)
  3. Check not paused (StablecoinConfig)
  4. CPI: mint_to (Token-2022)
  5. Update total_minted, minter.minted
  6. Emit TokensMinted event
```

### Transfer with Blacklist (SSS-2)
```
User → transfer_checked (Token-2022)
  1. Token-2022 reads TransferHook extension from mint
  2. Resolves ExtraAccountMetas PDA
  3. CPIs to Transfer Hook program
  4. Hook checks BlacklistEntry PDAs for source & dest owners
  5. If blacklisted → error, transfer rolled back
  6. If not → transfer completes
```

### Seize Flow
```
Seizer → SDK.seize() → SSS Program
  1. Verify Seizer role
  2. Verify permanent delegate enabled
  3. CPI: transfer_checked as permanent delegate
  4. Emit TokensSeized event
```

## Security Model

**Role-Based Access Control** — Five role types, each stored as a separate PDA. Master authority assigns/revokes roles. No arrays — scales to unlimited role holders.

**Feature Gating** — SSS-2 instructions check `config.enable_transfer_hook` / `config.enable_permanent_delegate` and fail gracefully on SSS-1 configs.

**Checked Arithmetic** — All u64 operations use `checked_add`/`checked_sub` to prevent overflow.

**PDA Authority** — The config PDA is the mint authority, freeze authority, and permanent delegate. All token operations go through the program via CPI with PDA signer seeds.

**Bump Storage** — PDA bumps are stored in account state, never recalculated.

## Token-2022 Extensions

| Extension | Purpose | When Enabled |
|-----------|---------|--------------|
| MetadataPointer | Points mint metadata to the mint itself | Always |
| PermanentDelegate | Allows seize (forced transfer) | SSS-2 |
| TransferHook | Enforces blacklist on every transfer | SSS-2 |
