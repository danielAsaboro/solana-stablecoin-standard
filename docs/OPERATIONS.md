# Operations Runbook

## Prerequisites

- Solana CLI installed (`solana --version`)
- Anchor CLI installed (`anchor --version`)
- Node.js 18+ and Yarn
- A funded keypair (`solana-keygen new` or existing)

## Deployment

### Localnet

```bash
# Build programs
anchor build

# Start local validator and deploy
anchor test --skip-lint
```

### Devnet

```bash
# Configure for devnet
solana config set --url devnet

# Ensure deployer has SOL
solana airdrop 5

# Build and deploy
anchor build
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show <PROGRAM_ID>
```

## Stablecoin Lifecycle

### 1. Initialize a Stablecoin

**SSS-1 (Minimal)**
```bash
sss-token init --preset sss-1 \
  --name "My Stablecoin" \
  --symbol "MUSD" \
  --uri "https://example.com/metadata.json" \
  --decimals 6 \
  --keypair ~/.config/solana/id.json
```

**SSS-2 (Compliant)**
```bash
sss-token init --preset sss-2 \
  --name "Compliant USD" \
  --symbol "cUSD" \
  --uri "https://example.com/metadata.json" \
  --decimals 6 \
  --transfer-hook-program <HOOK_PROGRAM_ID> \
  --keypair ~/.config/solana/id.json
```

After SSS-2 init, initialize the transfer hook's ExtraAccountMetas:
```bash
sss-token init-hook
```

### 2. Assign Roles

```bash
# Assign a minter
sss-token roles assign --role minter --user <PUBKEY>

# Assign a burner
sss-token roles assign --role burner --user <PUBKEY>

# Assign a pauser
sss-token roles assign --role pauser --user <PUBKEY>

# SSS-2 only: assign blacklister and seizer
sss-token roles assign --role blacklister --user <PUBKEY>
sss-token roles assign --role seizer --user <PUBKEY>

# Revoke a role
sss-token roles revoke --role minter --user <PUBKEY>

# List all roles
sss-token roles list
```

### 3. Configure Minter Quotas

```bash
# Set minter quota (in base units, e.g., 1,000,000 = 1 MUSD with 6 decimals)
sss-token minters add --minter <PUBKEY> --quota 1000000000

# Update quota
sss-token minters add --minter <PUBKEY> --quota 5000000000

# List minters and their quotas
sss-token minters list
```

### 4. Mint Tokens

```bash
sss-token mint --recipient <PUBKEY> --amount 1000000
```

The minter must:
- Have the Minter role assigned
- Have sufficient remaining quota (`quota - minted >= amount`)
- The stablecoin must not be paused

### 5. Burn Tokens

```bash
sss-token burn --amount 500000
```

The burner must have the Burner role assigned and the stablecoin must not be paused.

### 6. Freeze/Thaw Accounts

```bash
# Freeze a specific token account
sss-token freeze --address <TOKEN_ACCOUNT>

# Thaw a frozen account
sss-token thaw --address <TOKEN_ACCOUNT>
```

### 7. Pause/Unpause

```bash
# Pause all minting and burning
sss-token pause

# Resume operations
sss-token unpause
```

### 8. Check Status

```bash
# Full stablecoin status
sss-token status

# Supply information
sss-token supply
```

## SSS-2 Compliance Operations

### Blacklist Management

```bash
# Add address to blacklist
sss-token blacklist add --address <PUBKEY> --reason "Sanctions compliance"

# Remove from blacklist
sss-token blacklist remove --address <PUBKEY>

# Check if address is blacklisted
sss-token blacklist check --address <PUBKEY>

# List all blacklisted addresses
sss-token blacklist list
```

When an address is blacklisted:
- All `transfer_checked` calls involving that address will be rejected by the transfer hook
- The BlacklistEntry PDA stores the reason, timestamp, and who blacklisted it

### Seize Tokens

```bash
sss-token seize --from <TOKEN_ACCOUNT> --to <TREASURY_ACCOUNT> --amount 100000
```

Seize uses the permanent delegate extension. The source account owner does not need to sign.

### Transfer Authority

```bash
sss-token transfer-authority --new-authority <PUBKEY>
```

This transfers the master authority role. The new authority gains control of all role management.

## Monitoring

### View Audit Trail

All operations emit on-chain events. Use the SDK or backend API to query:

```typescript
const auditLog = new AuditLog(connection, configAddress);
const events = await auditLog.getEvents({ action: "mint", limit: 100 });
```

### Backend API

```bash
# Check backend health
curl http://localhost:3001/health

# Query audit log
curl http://localhost:3001/api/v1/audit

# Check blacklist
curl http://localhost:3001/api/v1/blacklist
```

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `Unauthorized` | Caller lacks required role | Assign role with `sss-token roles assign` |
| `QuotaExceeded` | Minter minted beyond quota | Increase quota with `sss-token minters add` |
| `Paused` | Stablecoin is paused | Run `sss-token unpause` |
| `ComplianceNotEnabled` | SSS-2 op on SSS-1 config | Re-initialize with `--preset sss-2` |
| `AlreadyBlacklisted` | Address already on blacklist | No action needed |
| `NotBlacklisted` | Trying to remove non-blacklisted address | Check address with `sss-token blacklist check` |
| `AccountFrozen` | Token account is frozen | Thaw with `sss-token thaw` |
| `Overflow` | Arithmetic overflow | Check amounts are within u64 range |

## Emergency Procedures

### Pause All Operations
```bash
sss-token pause --keypair <PAUSER_KEYPAIR>
```

### Freeze Compromised Account
```bash
sss-token freeze --address <TOKEN_ACCOUNT> --keypair <PAUSER_KEYPAIR>
```

### Seize from Compromised Account (SSS-2)
```bash
sss-token blacklist add --address <OWNER> --reason "Account compromise" --keypair <BLACKLISTER_KEYPAIR>
sss-token seize --from <TOKEN_ACCOUNT> --to <TREASURY> --amount <FULL_BALANCE> --keypair <SEIZER_KEYPAIR>
```
