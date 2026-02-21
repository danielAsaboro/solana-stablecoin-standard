# Solana Stablecoin Standard (SSS) — Development Guide

## Overview
SSS is a modular stablecoin toolkit for Solana with two presets:
- **SSS-1**: Minimal stablecoin (mint, burn, freeze, pause, roles)
- **SSS-2**: Compliant stablecoin (adds blacklist, seize, transfer hook enforcement)

## Architecture
- `programs/sss/` — Main Anchor program (Token-2022)
- `programs/transfer-hook/` — SPL Transfer Hook for blacklist enforcement
- `sdk/core/` — `@stbr/sss-core-sdk` TypeScript SDK
- `sdk/compliance/` — `@stbr/sss-compliance-sdk` compliance extensions
- `cli/` — `sss-token` CLI tool (commander.js)
- `backend/` — Rust/Axum API server with Docker
- `tests/` — Anchor integration tests
- `scripts/` — Devnet deployment examples

## Program IDs (localnet)
- SSS: `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu`
- Transfer Hook: `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH`

## PDA Seeds
- Config: `["stablecoin", mint]`
- Role: `["role", config, role_type_u8, user]`
- MinterQuota: `["minter_quota", config, minter]`
- BlacklistEntry: `["blacklist", config, address]`
- ExtraAccountMetas: `["extra-account-metas", mint]` (on hook program)

## Key Conventions
- Anchor 0.31.1 (CLI 0.32.1)
- Token-2022 for all token operations
- Config PDA owns mint authority, freeze authority, permanent delegate
- All instructions emit events
- Checked arithmetic everywhere (no unchecked math)
- Role-based access control: Minter(0), Burner(1), Pauser(2), Blacklister(3), Seizer(4)
- Feature gates: SSS-2 instructions check `config.enable_transfer_hook` / `config.enable_permanent_delegate`

## Build & Test
```bash
anchor build          # Build both programs
anchor test           # Run integration tests
yarn build            # Build SDK packages
yarn test:sdk         # Run SDK tests
```

## Dependency Pins
- `blake3 = "=1.5.5"` — Required for Solana BPF toolchain compatibility
- `constant_time_eq = "=0.3.1"` — Same reason
