# Testing Guide

All supported verification is local-only for now. Use Surfpool as the validator and run the repo from the root with `npm`.

## Canonical Workflow

```bash
npm run build
npm test
```

`npm test` runs `scripts/test-local.sh`, which:

1. builds all Anchor programs,
2. starts Surfpool from `Surfpool.toml`,
3. airdrops the active wallet,
4. exports `ANCHOR_PROVIDER_URL`, `ANCHOR_WALLET`, `SSS_LIVE_TESTS=1`, and `CLI_LIVE_TESTS=1`,
5. runs the Anchor, SDK, CLI, backend, fuzz, frontend, and TUI checks.

## Individual Commands

```bash
# Start Surfpool only
npm run surfpool:start

# On-chain integration tests against the current local RPC
npm run test:anchor

# SDK tests
npm run test:sdk

# CLI tests
npm run test:cli

# Backend tests
npm run test:backend

# Property / model tests
npm run test:fuzz

# Bonus surface validation
npm run test:frontend
npm run test:tui
```

## Environment

- `ANCHOR_PROVIDER_URL`: local RPC endpoint. Defaults to `http://127.0.0.1:8899`.
- `ANCHOR_WALLET`: wallet used for local transactions. Defaults to `~/.config/solana/id.json`.
- `SSS_LIVE_TESTS=1`: enables Surfpool-backed SDK behavior tests.
- `CLI_LIVE_TESTS=1`: enables Surfpool-backed CLI execution tests.

## Scope

- Required local coverage:
  - Anchor integration suite in `tests/`
  - SDK tests in `sdk/core/src/tests/` and `sdk/compliance/src/tests/`
  - CLI tests in `cli/tests/`
  - backend tests in `backend/tests/`
  - property tests in `trident-tests/`
    - model-wide state machine tests in `trident-tests/src/lib.rs`
    - targeted role tests in `trident-tests/tests/roles.rs`
    - targeted quota tests in `trident-tests/tests/quotas.rs`
    - targeted compliance tests in `trident-tests/tests/compliance.rs`
- Bonus validation:
  - frontend production build
  - TUI unit tests and binary build via `cargo test`

## Truthful Status

- The repo is currently verified locally with Surfpool.
- Devnet deployment proof is intentionally out of scope for this phase.
- Test counts should be taken from real local runs, not hard-coded into docs.

## Anchor Coverage

The main behavior suite still lives in `tests/` and covers:

- SSS-1 lifecycle
- SSS-2 compliance lifecycle
- role management
- quota management
- blacklist enforcement
- seizure flows
- authority rotation
- oracle and privacy companion modules
- edge cases and failure paths

## Backend Coverage

The backend tests live in `backend/tests/integration_tests.rs` and currently validate:

- health responses
- configured-service `200` responses for info, operations, compliance, and indexer routes
- webhook CRUD, dispatch, signing metadata, and delivery-state semantics
- JSONL export for the compliance audit route
- grouped operator timeline incidents and source filtering
- webhook delivery replay, incident-level replay, operator timeline JSONL export, and operator snapshot diff routes
- local persistence for webhook state, mint/burn operation logs, and compliance checks
- input validation helpers
- PDA derivation helpers
- degraded-mode `503` behavior for Solana-dependent routes

The CLI tests in `cli/tests/` now also cover audit-log normalization, JSONL formatting helpers, and `webhook verify` HMAC validation so machine-readable operator tooling remains stable.

The TUI tests cover the expanded tab model and backend-backed incident stream state, and frontend verification continues to rely on a clean production build with the operator timeline and snapshot surfaces enabled.

## Fuzz Coverage

The fuzz harness is split into a broad model test plus targeted suites:

- `trident-tests/src/lib.rs`
  - randomized SSS-1 and SSS-2 state machines
  - arithmetic overflow prevention
  - quota enforcement
  - access-control rejection
  - pause/unpause safety
  - feature gating
  - blacklist uniqueness
  - authority-transfer chains
  - role lifecycle
  - seize balance conservation
- `trident-tests/tests/roles.rs`
  - authority transfer preserves existing role-based capabilities while changing admin rights
  - SSS-1 rejects compliance-only role assignment
- `trident-tests/tests/quotas.rs`
  - quota reductions preserve historical minted amounts
  - one minter’s quota updates do not mutate another minter’s usage
- `trident-tests/tests/compliance.rs`
  - blacklist add/remove roundtrip consistency
  - seizure conserves aggregate balances
  - SSS-1 rejects blacklist/seize flows

## Running Specific Groups

```bash
# Run one Anchor file against the current local RPC
npm exec ts-mocha -p ./tsconfig.json -t 1000000 tests/sss-1.ts

# Run one SDK test file
cd sdk/core && npx mocha --require ts-node/register src/tests/pda.test.ts

# Run backend tests with output
cd backend && cargo test -- --nocapture
```

## CI

CI now validates npm-based package builds/tests plus Rust builds/lints. The full Surfpool-backed verification flow remains `npm test`.
