---
description: "Deploy SSS programs to devnet or mainnet with safety checks"
---

Deploy stablecoin programs with pre-deployment validation.

## Pre-Deployment Checklist

- [ ] All tests passing (141 anchor + 58 SDK + 17 CLI + 53 backend)
- [ ] `anchor build` succeeds without warnings
- [ ] `cargo clippy --all-targets` clean
- [ ] Program IDs in Anchor.toml match deploy keypairs
- [ ] Sufficient SOL balance for deployment

## Devnet Deployment

```bash
# 1. Set network
solana config set --url devnet

# 2. Check balance (need ~10 SOL for 4 programs)
solana balance

# 3. Airdrop if needed
solana airdrop 5

# 4. Deploy all programs
anchor deploy --provider.cluster devnet

# 5. Verify deployment
solana program show <SSS_PROGRAM_ID> --url devnet
solana program show <HOOK_PROGRAM_ID> --url devnet
solana program show <ORACLE_PROGRAM_ID> --url devnet
solana program show <PRIVACY_PROGRAM_ID> --url devnet
```

Or use the deployment script:
```bash
bash scripts/deploy-devnet.sh
```

## Post-Deployment

1. Record all program IDs and deployment tx signatures
2. Update `docs/DEVNET_DEPLOYMENT.md` with real data
3. Run smoke test on devnet (initialize, mint, transfer, blacklist)
4. Update README with devnet program IDs

## Mainnet Deployment

**REQUIRES EXPLICIT CONFIRMATION**

1. All devnet testing must pass first
2. Upgrade authority should be transferred to multisig
3. Consider making programs immutable after verification
