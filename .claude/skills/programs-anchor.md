# Anchor Framework Skill

## Project Structure

```
solana-stablecoin-standard/
├── Anchor.toml
├── programs/
│   ├── sss/                    # Core stablecoin program
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── instructions/   # Instruction handlers
│   │       ├── state.rs        # Account structures
│   │       ├── error.rs        # Error codes
│   │       └── events.rs       # Event definitions
│   ├── transfer-hook/          # Blacklist enforcement hook
│   ├── oracle/                 # Price feed integration
│   ├── privacy/                # Confidential transfer management
│   ├── sss-10/                 # Composable: cross-chain bridge
│   ├── sss-11/                 # Composable: CDP lending
│   ├── sss-caps/               # Composable: deposit caps
│   ├── sss-allowlist/          # Composable: allowlist
│   ├── sss-math/               # Shared math library
│   └── sss-timelock/           # Composable: timelock governance
├── sdk/
│   ├── core/                   # @stbr/sss-core-sdk
│   ├── compliance/             # @stbr/sss-compliance-sdk
│   └── token/                  # Token helpers
├── cli/                        # sss-token CLI
├── backend/                    # Rust/Axum API server
├── frontend/                   # Next.js dashboard
├── tui/                        # Terminal UI
├── tests/                      # Anchor integration tests
├── trident-tests/              # Fuzz tests
└── scripts/                    # Deployment scripts
```

## Version Management

### Anchor.toml Configuration
```toml
[toolchain]
anchor_version = "0.31.1"

[features]
seeds = true

[programs.localnet]
sss = "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
transfer_hook = "Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH"
oracle = "6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ"
privacy = "Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk"
```

## Testing Strategy

### Testing Pyramid

1. **Backend unit tests** (cargo test) - 53 tests, fastest
2. **SDK unit tests** (vitest) - 58 tests
3. **CLI smoke tests** - 17 tests
4. **Fuzz tests** (Trident) - 21 tests, ~11,800 cases
5. **Anchor integration** (Surfpool + Mocha) - 141 tests, most comprehensive

### Surfpool Setup
```bash
# Must run from project root
surfpool start --network mainnet --legacy-anchor-compatibility --yes --no-tui --no-studio
```

Key flags:
- `--network mainnet` — JIT mainnet account fetching
- `--yes` — Auto-deploy from Surfpool.toml
- `--legacy-anchor-compatibility` — Anchor test suite defaults

### TypeScript E2E Tests
```typescript
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);
const program = anchor.workspace.Sss as Program<Sss>;

it("initializes SSS-2 stablecoin", async () => {
  const tx = await program.methods
    .initialize({
      name: "Test USD",
      symbol: "TUSD",
      uri: "",
      decimals: 6,
      enableTransferHook: true,
      enablePermanentDelegate: true,
    })
    .accounts({ authority: authority.publicKey, ... })
    .signers([authority])
    .rpc();
});
```

## Build and Deploy

```bash
# Build all programs
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Verify
solana program show <PROGRAM_ID> --url devnet
```

## Architecture: Multi-Program Design

SSS uses 4 core programs:
- **sss** — Core logic, token operations, role management
- **transfer-hook** — Blacklist enforcement during Token-2022 transfers
- **oracle** — Switchboard V2 price feed for non-USD pegs
- **privacy** — Confidential transfer proof management

Plus 6 composable modules:
- **sss-caps** — Global and per-user deposit caps
- **sss-allowlist** — Address allowlist with modes
- **sss-timelock** — Time-delayed governance operations
- **sss-math** — Shared checked arithmetic library
- **sss-10** — Cross-chain bridge integration
- **sss-11** — CDP lending against stablecoin collateral

## Security

See `.claude/rules/anchor.md` for per-instruction checklist.
See `.claude/commands/audit-solana.md` for full audit process.
