---
description: "Run TypeScript tests for SDK, CLI, and Anchor integration"
---

Run all TypeScript test suites.

## Test Suites

### 1. SDK Unit Tests
```bash
npm run test:sdk
```
Expected: 58 tests passing (core + compliance)

### 2. CLI Smoke Tests
```bash
npm run test:cli
```
Expected: 17 tests passing (all 12 subcommands)

### 3. Anchor Integration Tests (requires Surfpool)
```bash
# Start Surfpool first
npm run surfpool:start &
sleep 10

# Run tests
anchor test --skip-build
```
Expected: 141 tests passing

## Prerequisites

- `npm run build:packages` must succeed before running tests
- Surfpool must be running for Anchor integration tests
- Use `{ commitment: "confirmed" }` provider to avoid blockhash expiration

## Troubleshooting

- **Import errors**: Rebuild packages with `npm run build:packages`
- **Blockhash expired**: Ensure Surfpool has `ticks_per_slot = 100` in Anchor.toml
- **"Program may not be used"**: Restart Surfpool from project root with `--yes`
