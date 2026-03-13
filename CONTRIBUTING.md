# Contributing to Solana Stablecoin Standard (SSS)

Thank you for your interest in contributing. This guide covers everything you need to get started, whether you're fixing a bug, adding a composable module, or proposing a new stablecoin preset.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [SSS Preset Matrix](#sss-preset-matrix)
- [Development Workflow](#development-workflow)
- [Implementing a New Module](#implementing-a-new-module)
- [Testing](#testing)
- [Code Standards](#code-standards)
- [Security Rules](#security-rules)
- [Pull Request Process](#pull-request-process)

## Prerequisites

- Rust 1.82+
- Anchor 0.31+ (CLI 0.32+)
- Solana CLI 2.1+
- Node.js 20+ (22+ recommended)
- npm 10+
- [Surfpool](https://docs.surfpool.dev/) (local test validator)

## Getting Started

```bash
git clone https://github.com/solanabr/solana-stablecoin-standard.git
cd solana-stablecoin-standard
npm install
anchor build
npm run build:packages

# Start local validator
npm run surfpool:start

# Run tests (in another terminal)
anchor test --skip-build
```

## Project Structure

```
programs/
  sss/               # Core stablecoin program (mint, burn, freeze, roles)
  transfer-hook/     # SPL Transfer Hook for blacklist enforcement (SSS-2)
  oracle/            # Switchboard V2 price feed integration
  privacy/           # Confidential transfer management (SSS-3)
  sss-caps/          # Composable: global and per-user deposit caps
  sss-allowlist/     # Composable: address allowlist with modes
  sss-timelock/      # Composable: time-delayed governance operations
  sss-math/          # Shared checked arithmetic library
  sss-10/            # Composable: cross-chain bridge integration
  sss-11/            # Composable: CDP lending module
sdk/
  core/              # @stbr/sss-core-sdk - TypeScript SDK
  compliance/        # @stbr/sss-compliance-sdk - compliance extensions
  token/             # Token helper utilities
cli/                 # sss-token CLI tool
backend/             # Rust/Axum API server with Docker
frontend/            # Next.js compliance dashboard
tui/                 # Terminal UI for stablecoin management
tests/               # Anchor integration tests
trident-tests/       # Fuzz and invariant tests
docs/                # Specifications, architecture, guides
scripts/             # Deployment and utility scripts
```

## SSS Preset Matrix

SSS defines three stablecoin presets across two dimensions: compliance level and privacy.

| Feature | SSS-1 (Minimal) | SSS-2 (Compliant) | SSS-3 (Private) |
|---------|-----------------|-------------------|-----------------|
| Mint/Burn | yes | yes | yes |
| Freeze/Pause | yes | yes | yes |
| Role-based access (5 types) | yes | yes | yes |
| Transfer Hook enforcement | no | **yes** | no |
| Permanent Delegate (seize) | no | **yes** | no |
| Blacklist/Seize | no | **yes** | no |
| Confidential Transfer | no | no | **yes** |
| GENIUS Act compliant | partial | **full** | full |

**Key constraint**: Feature gates are set at initialization and are immutable. An SSS-1 stablecoin can never gain SSS-2 capabilities. This is a feature — issuers can guarantee their users that seizure and blacklisting will never be possible.

### Composable Modules

Modules are standalone programs that extend any SSS preset:

| Module | Purpose | Status |
|--------|---------|--------|
| sss-caps | Deposit/mint caps per user and global | Complete |
| sss-allowlist | Address allowlist with configurable modes | Complete |
| sss-timelock | Time-delayed governance operations | Complete |
| sss-math | Shared checked arithmetic library | Complete |
| sss-10 | Cross-chain bridge integration | Complete |
| sss-11 | CDP lending against stablecoin collateral | Complete |

## Development Workflow

### Branching

```bash
git checkout -b <type>/<scope>-<description>
# Examples:
# feat/sss-oracle-staleness-check
# fix/hook-blacklist-lookup
# test/sdk-preset-validation
```

Types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `security`

### Build, Format, Lint, Test

Every change must pass this sequence before committing:

```bash
anchor build                              # compile programs
cargo fmt --all                           # format Rust
cargo clippy --all-targets -- -D warnings # lint Rust
anchor test --skip-build                  # integration tests (requires Surfpool)
npm run build:packages                    # compile SDK + CLI
npm run test:sdk                          # SDK unit tests
npm run test:cli                          # CLI smoke tests
```

### Commits

Use conventional commit messages:

```
feat(sss): add two-step authority transfer
fix(hook): correct blacklist PDA derivation in fallback handler
docs: add SSS-3 confidential transfer spec
test(sdk): add preset validation unit tests
security(sss): enforce minter quota ceiling check
```

## Implementing a New Module

### Step 1: Create the program

```bash
mkdir -p programs/sss-<name>/src
```

Follow the pattern in `programs/sss-caps/` or `programs/sss-allowlist/`.

### Step 2: Register in workspace

- `Cargo.toml` (root): Add to `[workspace] members`
- `Anchor.toml`: Add program ID under `[programs.localnet]`

### Step 3: Implement

- Config PDA: `["<module_name>_config", stablecoin_config]`
- Initialize instruction (authority-gated)
- Module-specific instructions
- Events for all state changes

### Step 4: Add SDK support

- Add module helpers to `sdk/core/`
- Add CLI commands if applicable

### Step 5: Test

- Unit tests for each instruction
- Integration test with SSS core program
- Negative tests (unauthorized, invalid state)

### Step 6: Document

Update README.md module table and add to `docs/`.

## Testing

| Suite | Command | Count |
|-------|---------|-------|
| Anchor integration | `anchor test --skip-build` | 141 |
| SDK unit tests | `npm run test:sdk` | 58 |
| CLI smoke tests | `npm run test:cli` | 17 |
| Backend tests | `cargo test --manifest-path backend/Cargo.toml` | 53 |
| Fuzz tests | `cd trident-tests && cargo test` | 21 (~11,800 cases) |
| **Total** | | **290** |

### Writing Tests

- Validate role-based access control for every privileged instruction
- Test feature gate enforcement (SSS-1 cannot use SSS-2 instructions)
- Check minter quota enforcement and reset behavior
- Test blacklist + transfer hook blocking flow end-to-end
- Verify events emitted with correct data
- Use `{ commitment: "confirmed" }` provider for Anchor tests

### Surfpool Setup

```bash
# Must run from project root
surfpool start --network mainnet --legacy-anchor-compatibility --yes --no-tui --no-studio
```

Surfpool is stateless — `--yes` re-runs the deployment runbook on each start.

## Code Standards

### Rust (Programs)

- No `unwrap()` — use `ok_or(ErrorCode::...)` or `checked_*` methods
- No unchecked arithmetic — always `checked_add`, `checked_sub`, etc.
- Store PDA bumps in account state, never recalculate
- Validate account owners, signers, and PDA derivations in constraints
- Validate CPI target program IDs
- Emit events for all state changes
- Check feature gates for all SSS-2 operations

### TypeScript (SDK & Tests)

- Use `BN` for all on-chain numeric values
- Derive PDAs using utility functions in `sdk/core/src/pda.ts`
- Handle errors with descriptive messages
- Use Anchor workspace pattern for test setup
- Import types with `import type` for type-only imports

### What to Avoid

- Comments stating the obvious
- Abstractions for one-time operations
- Defensive try/catch not present elsewhere in codebase
- Unused imports or dependencies
- Features beyond the scope of your change
- `// TODO: implement` without a linked issue

## Security Rules

These are non-negotiable:

1. **Feature gates are immutable.** SSS-1 can never execute SSS-2 instructions.
2. **Checked arithmetic everywhere.** Overflow in supply calculations is critical.
3. **Role-based access enforced per instruction.** Every privileged operation checks the caller's role PDA.
4. **Two-step authority transfer.** Never single-step. Always propose → accept.
5. **Seize requires blacklist entry.** Cannot seize from non-blacklisted addresses.
6. **Transfer hook validates on every transfer.** Blacklisted addresses are blocked in real-time.
7. **Minter quotas enforced on every mint.** Cannot mint beyond allocated quota.
8. **Devnet first.** Never deploy to mainnet without explicit confirmation.
9. **Events on every state change.** All compliance-relevant actions are logged.

## Pull Request Process

1. Branch from `main` using the naming convention above
2. Ensure build/format/lint/test all pass
3. Open PR against `main`
4. PR description must include:
   - What the change does and why
   - How to test it
   - Security considerations
   - Updated test counts if tests were added
5. Review checklist (applied by maintainers):
   - No AI slop
   - Error handling matches existing patterns
   - No unnecessary abstractions
   - Security checks present
   - Feature gates checked for SSS-2 instructions
   - Events emitted for all state changes
   - Documentation updated

## Questions?

Open an issue on the repository. For spec discussions about future SSS presets or modules, prefix your issue title with `[RFC]`.
