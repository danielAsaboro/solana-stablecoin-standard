# Solana Stablecoin Standard (SSS) — Development Guide

## Overview
SSS is a modular stablecoin toolkit for Solana with two presets:
- **SSS-1**: Minimal stablecoin (mint, burn, freeze, pause, roles)
- **SSS-2**: Compliant stablecoin (adds blacklist, seize, transfer hook enforcement)

## Architecture
- `programs/sss/` — Main Anchor program (Token-2022)
- `programs/transfer-hook/` — SPL Transfer Hook for blacklist enforcement
- `programs/oracle/` — Switchboard V2 price feed integration for non-USD pegs
- `sdk/core/` — `@stbr/sss-core-sdk` TypeScript SDK
- `sdk/compliance/` — `@stbr/sss-compliance-sdk` compliance extensions
- `cli/` — `sss-token` CLI tool (commander.js)
- `backend/` — Rust/Axum API server with Docker
- `tests/` — Anchor integration tests
- `scripts/` — Devnet deployment examples

## Program IDs (localnet)
- SSS: `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu`
- Transfer Hook: `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH`
- Oracle: `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ`

## PDA Seeds
- Config: `["stablecoin", mint]`
- Role: `["role", config, role_type_u8, user]`
- MinterQuota: `["minter_quota", config, minter]`
- BlacklistEntry: `["blacklist", config, address]`
- ExtraAccountMetas: `["extra-account-metas", mint]` (on hook program)
- OracleConfig: `["oracle_config", stablecoin_config]` (on oracle program)

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
anchor build                    # Build all four programs
anchor test --skip-build        # Run integration tests (requires Surfpool running)
npm run test:local              # Full test suite (starts Surfpool automatically)
npm run test:anchor             # Anchor tests only (requires Surfpool running)
npm run build:packages          # Build SDK + CLI packages
npm run test:sdk                # SDK unit tests
```

## Local Validator: Surfpool

The project uses **Surfpool** (drop-in for solana-test-validator) running on port 8899.
Surfpool forks mainnet JIT — Token-2022 and other mainnet programs are fetched automatically.

### Starting Surfpool correctly

**Must run from the project root directory** (not from any other project):

```bash
cd /path/to/solana-stablecoin-standard
surfpool start --network mainnet --legacy-anchor-compatibility --yes --no-tui --no-studio
```

Or use the npm script:
```bash
npm run surfpool:start
```

### Critical flags
- `--network mainnet` — enables JIT mainnet account fetching (Token-2022, etc.)
- `--yes` — auto-generates the deployment runbook from `Surfpool.toml` without prompts
- `--legacy-anchor-compatibility` — applies anchor-test-suite defaults for runbook generation
- WITHOUT `--yes`: runbook is not generated → programs not deployed → all tests fail

### Auto-deploy mechanism
Surfpool reads `Surfpool.toml` → generates a `deployment` runbook → deploys all `.so` files at their keypair addresses. Check deployment succeeded:
```bash
curl -s -X POST http://localhost:8899 -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getSurfnetInfo","params":[]}' | python3 -m json.tool
# Should show: runbookExecutions: [{runbookId: "deployment", errors: null}]
```

### If programs are missing after restart
Surfpool is **stateless** — state is lost on restart. The `--yes` flag re-runs the deployment runbook on each start. If you started Surfpool without `--yes`, manually deploy:
```bash
anchor deploy --provider.cluster localnet
```

### Surfpool cheatcodes (useful for testing)
- `surfnet_setAccount` — override any account's lamports/data/owner/executable
- `surfnet_setTokenAccount` — set token balances directly
- `surfnet_timeTravel` — advance clock to test time-sensitive logic
- `surfnet_resetNetwork` — wipe all state back to initial
- `surfnet_getSurfnetInfo` — check runbook execution status

Dashboard (when not using `--no-studio`): http://localhost:18488

## Dependency Pins
- `blake3 = "=1.5.5"` — Required for Solana BPF toolchain compatibility
- `constant_time_eq = "=0.3.1"` — Same reason
