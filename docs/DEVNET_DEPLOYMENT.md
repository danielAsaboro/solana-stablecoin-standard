# Devnet Deployment Guide

> Step-by-step instructions for deploying the Solana Stablecoin Standard (SSS) to Solana devnet, with automated scripts and example transactions.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Deploy (Automated)](#quick-deploy-automated)
- [Manual Deployment](#manual-deployment)
- [Program IDs](#program-ids)
- [Demo Scripts](#demo-scripts)
- [Example Transactions](#example-transactions)
- [Localnet Deployment Proof](#localnet-deployment-proof)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

1. **Solana CLI** 1.18+ installed and configured
2. **Anchor CLI** 0.31.1+ installed
3. **Node.js** 18+ with Yarn
4. **Programs built**: `anchor build` (compiles all 3 programs)
5. **SDK built**: `yarn build` (compiles TypeScript SDK/CLI)
6. **Devnet SOL**: ~7 SOL required for deploying 3 programs

### Checking your setup

```bash
solana --version         # 1.18.x or higher
anchor --version         # 0.31.x or higher
node --version           # v18+ or higher
solana balance --url devnet  # Check devnet balance
```

### Getting devnet SOL

```bash
# CLI airdrop (2 SOL per request, may be rate-limited)
solana airdrop 2 --url devnet

# If CLI is rate-limited, use the web faucet:
# https://faucet.solana.com
```

---

## Quick Deploy (Automated)

Run the automated deployment script:

```bash
# From the project root
./scripts/deploy-devnet.sh
```

This script:
1. Switches Solana CLI to devnet
2. Checks wallet balance
3. Deploys all 3 programs (SSS, Transfer Hook, Oracle)
4. Runs SSS-1 demo (init, roles, mint, burn, freeze, thaw, pause, unpause)
5. Runs SSS-2 demo (init, hook, roles, mint, blacklist, seize, unblacklist)
6. Outputs all program IDs, tx signatures, and Explorer links
7. Restores original CLI config

---

## Manual Deployment

### Step 1: Configure for Devnet

```bash
# Save current config
solana config get

# Switch to devnet
solana config set --url https://api.devnet.solana.com

# Verify
solana config get
```

### Step 2: Build Programs

```bash
anchor build
```

This produces three program binaries:
- `target/deploy/sss.so` (463 KB)
- `target/deploy/transfer_hook.so` (230 KB)
- `target/deploy/sss_oracle.so` (254 KB)

### Step 3: Deploy Programs

```bash
# Deploy SSS program
anchor deploy --program-name sss --provider.cluster devnet

# Deploy Transfer Hook program
anchor deploy --program-name transfer_hook --provider.cluster devnet

# Deploy Oracle program
anchor deploy --program-name sss_oracle --provider.cluster devnet
```

### Step 4: Verify Deployment

```bash
# Check programs are deployed
solana program show <SSS_PROGRAM_ID> --url devnet
solana program show <HOOK_PROGRAM_ID> --url devnet
solana program show <ORACLE_PROGRAM_ID> --url devnet
```

### Step 5: Run Demo Transactions

```bash
# SSS-1 demo (init, mint, burn, freeze, thaw, pause, unpause)
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/deploy-devnet.ts

# SSS-2 demo (init, hook, roles, mint, blacklist, seize, unblacklist)
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/deploy-sss2-devnet.ts
```

### Step 6: Restore Config

```bash
solana config set --url http://localhost:8899
```

---

## Program IDs

### Localnet (Development)

| Program       | Address                                          |
| ------------- | ------------------------------------------------ |
| SSS           | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` |
| Transfer Hook | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` |
| Oracle        | `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ` |

### PDA Seeds

| PDA               | Seeds                                             |
| ----------------- | ------------------------------------------------- |
| Config            | `["stablecoin", mint]`                           |
| Role              | `["role", config, role_type_u8, user]`           |
| MinterQuota       | `["minter_quota", config, minter]`               |
| BlacklistEntry    | `["blacklist", config, address]`                 |
| ExtraAccountMetas | `["extra-account-metas", mint]` (hook program)   |
| OracleConfig      | `["oracle_config", stablecoin_config]` (oracle)  |

---

## Demo Scripts

### `scripts/deploy-devnet.ts` — SSS-1 Full Lifecycle

Demonstrates all SSS-1 operations:

| Step | Operation          | Description                           |
| ---- | ------------------ | ------------------------------------- |
| 1    | `initialize`       | Create SSS-1 stablecoin (6 decimals)  |
| 2    | `update_roles`     | Assign Minter, Burner, Pauser roles   |
| 3    | `update_minter`    | Set 1M token minting quota            |
| 4    | `mint_tokens`      | Mint 100 tokens to authority           |
| 5    | `burn_tokens`      | Burn 10 tokens                         |
| 6    | `freeze_account`   | Freeze authority's token account       |
| 7    | `thaw_account`     | Thaw the frozen account                |
| 8    | `pause`            | System-wide pause (blocks all ops)     |
| 9    | `unpause`          | Resume operations                      |

### `scripts/deploy-sss2-devnet.ts` — SSS-2 Compliance Lifecycle

Demonstrates all SSS-2 compliance operations:

| Step | Operation                   | Description                                   |
| ---- | --------------------------- | --------------------------------------------- |
| 1    | `initialize`                | Create SSS-2 with PD + Transfer Hook          |
| 2    | `initializeExtraAccountMetas`| Set up transfer hook account resolution       |
| 3    | `update_roles`              | Assign all 5 roles (incl. Blacklister, Seizer)|
| 4    | `mint_tokens`               | Mint 500 tokens to authority                   |
| 5    | `mint_tokens`               | Mint 200 tokens to second user                 |
| 6    | `add_to_blacklist`          | Blacklist second user (OFAC reason)            |
| 7    | `seize`                     | Seize 200 tokens via permanent delegate        |
| 8    | `remove_from_blacklist`     | Remove second user from blacklist              |

---

## Example Transactions

### SSS-1 Localnet Proof

All operations executed successfully on local validator with programs deployed at the same addresses used for devnet:

```
Program ID: DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu
Authority:  CChvxUR37fry8i2Gdvyrmwu2PH8vgZeTcFwtNqLxaHDW

--- SSS-1 Operations ---
Initialize:  5su3q5RDgEw1oHVzSzQAL2PXiY34CB4BCuFgcgCN2LAp8XLvLpMup6K7Bgre5eX81JUzbAhanwyr79An3Mccd4kn
Mint:        5pvLCnhdYPHVwVC3y1AXqxb1wf6qwp4zYGwhYaXKUBNzQJ548oKNAG15MrcBFCj74pGZr7PFGCD8rymKksTDZmyo
Burn:        5DsiDTnqA4aybTgZEfgbQsjyEaNH7P4dAvbdPgvFkoT2kDPRA11nnHwa5sAr1k6mmDonBa8QCHykgbxEZTeR4YAF
Freeze:      4PEtXS4UhnQjDghzGPXdW4FwbCwUohQhf5ELSsXqaCMiEQXgNEcvMVF3YhYkEeMGpqFkTH9GdKk1zj8U4s5t2hQ
Thaw:        5wTs6ieVgKRBVGNqtreBb8aYWnomqaqtDPbzg7sMjNbN98g6vFUFpK45swuYrcmLHxMNA7exEYPVs4wbgz34djUj
Pause:       4xQCP55eJyAfWnik2uypdmiaRH1x9t54bXgYb5n1bNEQoW3gW294JpoxUghFbeSsPVPCqS4TYdUS2EGvxptoJhyK
Unpause:     2fCQZHjdEvzR57dCCdeD2fois4hPEdmjZUM82P2op65NoUDrNtffZip31E6P7d1mUMXnypMQRqRKZTnFt4iJdUfP

Final State:
  Name: SSS Demo USD | Symbol: sUSD | Decimals: 6
  Total Minted: 100,000,000 (100 tokens)
  Total Burned: 10,000,000 (10 tokens)
  Net Supply: 90 tokens
```

### SSS-2 Localnet Proof

Full compliance lifecycle including permanent delegate seize with transfer hook:

```
SSS Program:  DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu
Hook Program: Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH
Authority:    CChvxUR37fry8i2Gdvyrmwu2PH8vgZeTcFwtNqLxaHDW

--- SSS-2 Operations ---
Initialize:   533Xi1MQPe4vQ8zP3XpAw2BwRkCwFnTf6SziGFEeYkB8Uw49wdW62F4tuuQAbfPkHz5a8VTpJnCmzQB2ENdpciaU
Init Hook:    4BVY3dT1WzXZ3ENL29am9vWThQtFJg1fXSyrwUtGzkVPgLtTvSEjYBh4rvxShNyrGtT1fTrnKEsCkhNrdUVnQyx4
Mint (auth):  59AaFripQTPpd1uQ2ukiAH9KM47wBn4dm2MVRZh5YaBDkCjEjRoYKn18DKMzbMdF5aLfebFN1LjszknNwgHQ1jgS
Mint (user):  4XQv9uYA31zLANtccSNzxQ4Esz1cExp72n1uhUQb66BcGiVoVsgW67x5JE5rAyEWhBb7P5pySprmLZJ5LWsLcdLA
Blacklist:    3yiWkxC22NFSpN3EkmNM9mrK3Ao7Rqjk6sLhpaxky8trMwWRCKQL9EnnWTsGgT7V3ciLBqntCR4Gwn6YRonSS2fx
Seize:        REwUV7x4jVFCeGbn47HHzRdC9D6nfCLvAGEhc2qq6B2cYxUBnhNJfxsW44LamUtK3vvR1xunukFcP4Kv4neH4Zs
Unblacklist:  4hLqK6yrT5SMdTF46Gb6oP9afeh224CsPJHoFsZjniGy9C9n75NqyYy5ASdfkzNySLzLUAwGrPA4Xvtd7iKW6Wg3

Final State:
  Name: SSS-2 Compliant USD | Symbol: cUSD | Decimals: 6
  Total Minted: 700,000,000 (700 tokens)
  Permanent Delegate: enabled
  Transfer Hook: enabled (Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH)
```

---

## Localnet Deployment Proof

The programs have been verified on a local Solana validator (`solana-test-validator`) with all three programs deployed and exercised through 96 integration tests covering:

- **SSS-1 lifecycle**: initialize, roles, quotas, mint, burn, freeze, thaw, pause, unpause, authority transfer
- **SSS-2 compliance**: blacklist add/remove, seize via permanent delegate, transfer hook enforcement
- **Edge cases**: zero amounts, overflow protection, duplicate blacklist, role self-revocation, invalid inputs
- **Authority rotation**: full A -> B -> C -> A authority transfer chain with role persistence/revocation
- **Multi-minter**: concurrent minters with independent quotas

### Test Results

```
  96 passing (integration tests)
  53 passing (backend integration tests)
  21 passing (fuzz tests — ~11,800 randomized cases)
  ---
  170 total tests passing
```

### Reproducing Locally

```bash
# Build everything
anchor build
yarn build

# Run all integration tests (starts local validator automatically)
anchor test --skip-lint

# Run backend tests
cd backend && cargo test

# Run fuzz tests
cd trident-tests && cargo test

# Run demo scripts against local validator
solana-test-validator \
  --bpf-program DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu target/deploy/sss.so \
  --bpf-program Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH target/deploy/transfer_hook.so \
  --bpf-program 6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ target/deploy/sss_oracle.so \
  --reset &

sleep 8

ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/deploy-devnet.ts

ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
npx ts-node scripts/deploy-sss2-devnet.ts
```

---

## Troubleshooting

### Insufficient SOL for deployment

Each program requires rent-exempt storage (~1.5-3.5 SOL depending on binary size). If the devnet faucet is rate-limited:

1. Try the web faucet: https://faucet.solana.com
2. Request smaller amounts: `solana airdrop 1 --url devnet`
3. Wait and retry (daily limits reset)
4. Use a different wallet address

### Program already deployed

If a program is already deployed at the target address:

```bash
# Upgrade an existing deployment
anchor upgrade target/deploy/sss.so --program-id <PROGRAM_ID> --provider.cluster devnet
```

### "Transaction simulation failed"

1. Check the program logs: `solana logs --url devnet`
2. Verify account balances: `solana balance --url devnet`
3. Ensure the correct wallet is configured: `solana address`

### Transfer hook seize fails

The seize operation on SSS-2 tokens requires transfer hook extra accounts. The demo script handles this automatically using `addExtraAccountMetasForExecute` from `@solana/spl-token`.
