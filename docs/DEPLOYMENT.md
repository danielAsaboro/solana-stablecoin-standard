# Deployment Guide

This guide covers deploying the Solana Stablecoin Standard programs from development through mainnet, including key management, verification, and upgrade procedures.

---

## Prerequisites

### Required Software

| Tool | Minimum Version | Install |
|------|----------------|---------|
| Rust | 1.75.0+ | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| Solana CLI | 1.18+ | See [docs.solana.com](https://docs.solana.com/cli/install-solana-cli-tools) |
| Anchor CLI | 0.31.1 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.31.1` |
| Node.js | 18+ | `nvm install 18` |
| npm | 8+ | Bundled with Node.js |
| surfpool | latest | `cargo install surfpool` (for local dev) |

### Verify Installations

```bash
rustc --version      # rustc 1.75.0+
solana --version     # solana-cli 1.18.x
anchor --version     # anchor-cli 0.31.1 (cli 0.32.1)
node --version       # v18.x.x
npm --version        # 8.x.x
```

### Project Setup

```bash
git clone <repo-url> solana-stablecoin-standard
cd solana-stablecoin-standard
npm install
```

---

## Environment Setup

### Solana CLI Configuration

```bash
# Check current config
solana config get

# Set for local development
solana config set --url http://127.0.0.1:8899

# Set for devnet
solana config set --url https://api.devnet.solana.com

# Set for mainnet
solana config set --url https://api.mainnet-beta.solana.com
```

### Keypair Setup

```bash
# Generate a new keypair
solana-keygen new --outfile ~/.config/solana/id.json

# Show public key
solana address

# Check balance
solana balance
```

For production deployments, use a hardware wallet (Ledger):

```bash
# Use Ledger hardware wallet
solana config set --keypair usb://ledger?key=0

# Verify Ledger is connected
solana address
```

### Environment Variables

Create a `.env` file (never commit this):

```bash
# Local development
RPC_URL=http://127.0.0.1:8899
SSS_PROGRAM_ID=DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu
HOOK_PROGRAM_ID=Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH
ORACLE_PROGRAM_ID=6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ
PRIVACY_PROGRAM_ID=Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk

# Backend
SSS_API_KEY=your-secure-api-key
SSS_MINT_ADDRESS=  # Set after first deployment
SSS_KEYPAIR_PATH=~/.config/solana/id.json
```

---

## Local Deployment with Surfpool

Surfpool is a local test validator that forks mainnet JIT. It deploys all programs automatically from `Surfpool.toml`.

### Starting Surfpool

```bash
# Must run from project root
cd /path/to/solana-stablecoin-standard

# Start with all required flags
surfpool start \
  --network mainnet \
  --yes \
  --legacy-anchor-compatibility \
  --no-tui \
  --no-studio

# Or use the npm script (equivalent)
npm run surfpool:start
```

**Critical flags explained:**

| Flag | Purpose |
|------|---------|
| `--network mainnet` | Enables JIT mainnet account fetching (Token-2022, etc.) |
| `--yes` | Auto-generates deployment runbook from `Surfpool.toml` without prompts |
| `--legacy-anchor-compatibility` | Applies anchor-test-suite defaults |
| `--no-tui` | Disable terminal UI (useful for CI) |

### Verify Deployment

```bash
# Check all programs are deployed
curl -s -X POST http://localhost:8899 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"surfnet_getSurfnetInfo","params":[]}' \
  | python3 -m json.tool
# Should show: runbookExecutions: [{runbookId: "deployment", errors: null}]

# Verify a specific program
solana program show DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu
```

### Running Tests Locally

```bash
# Full test suite (starts Surfpool automatically)
npm test

# Anchor tests only (requires Surfpool already running)
npm run test:anchor

# SDK unit tests
npm run test:sdk

# CLI smoke tests
npm run test:cli

# Backend integration tests
npm run test:backend

# Fuzz tests
npm run test:fuzz
```

---

## Building Programs

```bash
# Build all programs
anchor build

# Build specific program
anchor build --program-name sss
anchor build --program-name transfer-hook
anchor build --program-name oracle
anchor build --program-name privacy
anchor build --program-name sss-caps
anchor build --program-name sss-allowlist
anchor build --program-name sss-timelock
anchor build --program-name sss-10
anchor build --program-name sss-11

# Build TypeScript SDK and CLI
npm run build:packages
```

Build artifacts are placed in `target/deploy/`:
- `sss.so`
- `transfer_hook.so`
- `oracle.so`
- `privacy.so`

---

## Devnet Deployment

### Step 1: Fund Your Deployer

```bash
# Switch to devnet
solana config set --url https://api.devnet.solana.com

# Airdrop SOL (devnet only)
solana airdrop 5

# Verify balance (deployment requires ~5-10 SOL per program)
solana balance
```

### Step 2: Generate Program Keypairs

For stable addresses across re-deployments, use dedicated keypairs per program:

```bash
mkdir -p deploy-keys

# Generate keypairs for each program
solana-keygen new --outfile deploy-keys/sss.json --no-bip39-passphrase
solana-keygen new --outfile deploy-keys/transfer-hook.json --no-bip39-passphrase
solana-keygen new --outfile deploy-keys/oracle.json --no-bip39-passphrase
solana-keygen new --outfile deploy-keys/privacy.json --no-bip39-passphrase

# Note the public keys
solana-keygen pubkey deploy-keys/sss.json
solana-keygen pubkey deploy-keys/transfer-hook.json
solana-keygen pubkey deploy-keys/oracle.json
solana-keygen pubkey deploy-keys/privacy.json
```

### Step 3: Update Program IDs

Update `Anchor.toml` with the new program IDs:

```toml
[programs.devnet]
sss = "YourNewSSSProgramId11111111111111111111111111"
transfer_hook = "YourNewHookProgramId1111111111111111111111111"
oracle = "YourNewOracleProgramId111111111111111111111111"
privacy = "YourNewPrivacyProgramId11111111111111111111111"
```

Update the `declare_id!()` macro in each program's `lib.rs`:

```rust
// programs/sss/src/lib.rs
declare_id!("YourNewSSSProgramId11111111111111111111111111");
```

Rebuild after updating IDs:

```bash
anchor build
```

### Step 4: Deploy to Devnet

```bash
# Deploy all programs
anchor deploy --provider.cluster devnet

# Deploy specific program with keypair
anchor deploy \
  --program-name sss \
  --program-keypair deploy-keys/sss.json \
  --provider.cluster devnet

# Deploy each program
for prog in sss transfer-hook oracle privacy; do
  anchor deploy \
    --program-name $prog \
    --program-keypair deploy-keys/$prog.json \
    --provider.cluster devnet
done
```

### Step 5: Initialize a Test Stablecoin on Devnet

```bash
# Using the CLI
sss-token init \
  --preset sss-1 \
  --name "Devnet USD" \
  --symbol "DUSD" \
  --uri "https://example.com/dusd-metadata.json" \
  --decimals 6 \
  --keypair ~/.config/solana/id.json \
  --rpc https://api.devnet.solana.com

# Verify the config was created
sss-token info --rpc https://api.devnet.solana.com
```

### Step 6: Verify on Devnet Explorer

```bash
# Get the config PDA address
sss-token info --output json | jq .configAddress

# View on explorer
echo "https://explorer.solana.com/address/<CONFIG_PDA>?cluster=devnet"
```

---

## Mainnet Deployment Checklist

Before deploying to mainnet, complete all items in this checklist.

### Pre-Deployment Security

- [ ] Security audit completed by a reputable firm
- [ ] All audit findings addressed and re-audited
- [ ] Program IDLs published and verified
- [ ] Emergency response plan documented
- [ ] Multi-sig configured as master authority (minimum 2-of-3)
- [ ] Upgrade authority set to a multi-sig or frozen
- [ ] Supply cap configured appropriate for launch
- [ ] Role assignments reviewed and minimized

### Infrastructure

- [ ] RPC provider selected (Helius, QuickNode, or self-hosted)
- [ ] Backend deployed to production environment
- [ ] API key rotated from development value
- [ ] Monitoring and alerting configured
- [ ] Webhook endpoints tested
- [ ] Incident response runbook ready

### Legal / Compliance

- [ ] Regulatory licenses obtained if required
- [ ] AML/KYC program in place for SSS-2
- [ ] OFAC screening integrated
- [ ] Terms of service published
- [ ] Privacy policy published

### Deployment Steps

```bash
# 1. Switch to mainnet
solana config set --url https://api.mainnet-beta.solana.com

# 2. Verify deployer has sufficient SOL (~10 SOL per program)
solana balance

# 3. Build with release profile
anchor build -- --release

# 4. Deploy programs
anchor deploy --program-name sss --program-keypair deploy-keys/sss.json
anchor deploy --program-name transfer-hook --program-keypair deploy-keys/transfer-hook.json
# etc.

# 5. Initialize with multi-sig as master authority
sss-token init \
  --preset sss-2 \
  --name "My Stablecoin" \
  --symbol "MSTBL" \
  --uri "https://cdn.example.com/mstbl/metadata.json" \
  --decimals 6 \
  --master-authority <SQUADS_VAULT_PDA> \
  --hook-program <HOOK_PROGRAM_ID> \
  --keypair deploy-keys/deployer.json \
  --rpc https://api.mainnet-beta.solana.com

# 6. Verify on mainnet
sss-token info
```

---

## Program Upgrade Process

Solana programs can be upgraded if the upgrade authority is set. The SSS programs use Anchor's standard upgrade mechanism.

### Who Can Upgrade

The upgrade authority is a separate keypair/multisig that can replace the program bytecode. It is independent of the SSS master authority.

```bash
# Show current upgrade authority
solana program show <PROGRAM_ID>

# Transfer upgrade authority to a multisig
solana program set-upgrade-authority <PROGRAM_ID> \
  --new-upgrade-authority <NEW_AUTHORITY> \
  --keypair ~/.config/solana/upgrade-authority.json
```

### Upgrading a Program

```bash
# 1. Build the new version
anchor build

# 2. Write the buffer (stages the new .so without deploying)
solana program write-buffer target/deploy/sss.so \
  --keypair ~/.config/solana/upgrade-authority.json

# Output: Buffer: <BUFFER_ADDRESS>

# 3. Review the buffer (verify size and content hash)
solana program show <BUFFER_ADDRESS>

# 4. Upgrade the program from the buffer
solana program upgrade <BUFFER_ADDRESS> <PROGRAM_ID> \
  --keypair ~/.config/solana/upgrade-authority.json

# 5. Verify the upgrade
anchor idl upgrade -f target/idl/sss.json <PROGRAM_ID>
```

### Freezing the Upgrade Authority (Immutable)

For maximum trust, freeze the upgrade authority to make the program permanently immutable:

```bash
# WARNING: This is irreversible. The program can never be upgraded.
solana program set-upgrade-authority <PROGRAM_ID> --final \
  --keypair ~/.config/solana/upgrade-authority.json
```

---

## Key Management

### Keypair Hierarchy

```
Master Authority (Squads multisig)
├── Role Management
├── Supply Cap Updates
└── Authority Transfer

Deployer Keypair
└── Program Deployment/Upgrades

Operational Keypairs
├── Minter 1 (bank/treasury)
├── Minter 2 (market maker)
├── Pauser (compliance team)
├── Blacklister (sanctions team)
└── Seizer (legal/recovery team)

Caps Authority (risk team)
Allowlist Authority (KYC team)
Oracle Authority (data team)
```

### Hardware Wallet Usage

```bash
# Deploy using Ledger
anchor deploy \
  --keypair usb://ledger?key=0 \
  --provider.cluster mainnet

# Sign with Ledger for SSS operations
sss-token init \
  --keypair usb://ledger?key=0 \
  --rpc https://api.mainnet-beta.solana.com \
  # ...
```

### Key Rotation Schedule

| Key Type | Rotation Frequency | Method |
|----------|-------------------|--------|
| Deployer keypair | After each deployment | Generate new keypair |
| Operational minter keys | Monthly or on personnel change | `update_roles` to revoke old, add new |
| Pauser/Blacklister keys | On personnel change | Same as above |
| Master authority | Annually or on major incidents | 2-step authority transfer |
| Upgrade authority | On major version releases | `set-upgrade-authority` |

---

## Post-Deployment Verification

```bash
# Verify program is deployed
solana program show <PROGRAM_ID>

# Verify the IDL matches
anchor idl fetch <PROGRAM_ID>

# Verify stablecoin config
sss-token info

# Run a test mint (if authorized)
sss-token mint --amount 1 --recipient <YOUR_TOKEN_ACCOUNT>

# Verify supply
sss-token info --output json | jq .totalMinted

# Check Transfer Hook (SSS-2)
sss-token info --output json | jq .transferHookProgram

# Test blacklist enforcement (SSS-2)
# This transfer should fail if the source is blacklisted:
# Expected: "Source address is blacklisted" error
```

### Backend Verification

```bash
# Start backend
SSS_MINT_ADDRESS=<MINT_ADDRESS> \
SSS_API_KEY=<API_KEY> \
cargo run --manifest-path backend/Cargo.toml

# Check health
curl http://localhost:3001/health

# Check service info
curl -H "x-api-key: $API_KEY" http://localhost:3001/api/v1/info
```

---

## Troubleshooting

### "Program failed to complete" on deployment

Usually means insufficient SOL for the deployment. Programs require rent-exempt SOL proportional to their bytecode size:

```bash
# Calculate required SOL for a program
PROGRAM_SIZE=$(wc -c < target/deploy/sss.so)
echo "Program size: $PROGRAM_SIZE bytes"
# Requires approximately PROGRAM_SIZE * 2 lamports + buffer
```

### "Attempt to load a program that does not exist"

The program ID in `declare_id!()` does not match the deployed program's address. Rebuild after updating `Anchor.toml`:

```bash
anchor build && anchor deploy
```

### Programs not deployed after Surfpool restart

Surfpool is stateless. Always start with `--yes`:

```bash
surfpool start --network mainnet --yes --legacy-anchor-compatibility
```

Or manually redeploy:

```bash
anchor deploy --provider.cluster localnet
```

### "BlockhashNotFound" in tests

This indicates the test validator is under load or the commitment level is too low. Add `{ commitment: "confirmed" }` to RPC calls and ensure `ticks_per_slot = 100` in `Anchor.toml`.
