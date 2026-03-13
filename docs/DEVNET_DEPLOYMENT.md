# Deployment Status

Remote deployment proof is deferred. The only supported verification flow in this phase is local Surfpool testing.

## Prerequisites

1. Solana CLI 1.18+ installed and configured
2. Anchor CLI 0.31.1+ installed
3. Node.js 18+ with npm
4. `anchor build` succeeds locally
5. `npm run build:packages` succeeds locally
6. `surfpool` is installed and available on `PATH`

## Supported Workflow

```bash
solana --version
anchor --version
node --version

npm install
npm run build
npm test
```

## Local Verification Notes

`npm test` calls `scripts/test-local.sh`, which:

1. builds the four local programs,
2. starts Surfpool from `Surfpool.toml`,
3. airdrops the active local wallet,
4. runs the current local verification surface.

## Local Program IDs

| Program       | Address                                          |
| ------------- | ------------------------------------------------ |
| SSS           | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` |
| Transfer Hook | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` |
| Oracle        | `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ` |
| Privacy       | `Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk` |

## PDA Seeds

| PDA               | Seeds                                               |
| ----------------- | --------------------------------------------------- |
| Config            | `["stablecoin", mint]`                              |
| Role              | `["role", config, role_type_u8, user]`              |
| MinterQuota       | `["minter_quota", config, minter]`                  |
| BlacklistEntry    | `["blacklist", config, address]`                    |
| ExtraAccountMetas | `["extra-account-metas", mint]`                     |
| OracleConfig      | `["oracle_config", stablecoin_config]`              |
| PrivacyConfig     | `["privacy_config", stablecoin_config]`             |
| AllowlistEntry    | `["allowlist", privacy_config, address]`            |

## Current Policy

- Do not use this repo as evidence of current devnet deployment.
- Do not claim current explorer links or remote transaction signatures until they are regenerated.
- Use `npm test` output as the current source of truth for verification.

## Historical Localnet Examples

These examples are kept as reference output from earlier local runs. They are not remote deployment proof.

### SSS-1 Localnet Example

```text
Program ID: DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu
Initialize:  5su3q5RDgEw1oHVzSzQAL2PXiY34CB4BCuFgcgCN2LAp8XLvLpMup6K7Bgre5eX81JUzbAhanwyr79An3Mccd4kn
Mint:        5pvLCnhdYPHVwVC3y1AXqxb1wf6qwp4zYGwhYaXKUBNzQJ548oKNAG15MrcBFCj74pGZr7PFGCD8rymKksTDZmyo
Burn:        5DsiDTnqA4aybTgZEfgbQsjyEaNH7P4dAvbdPgvFkoT2kDPRA11nnHwa5sAr1k6mmDonBa8QCHykgbxEZTeR4YAF
Freeze:      4PEtXS4UhnQjDghzGPXdW4FwbCwUohQhf5ELSsXqaCMiEQXgNEcvMVF3YhYkEeMGpqFkTH9GdKk1zj8U4s5t2hQ
Thaw:        5wTs6ieVgKRBVGNqtreBb8aYWnomqaqtDPbzg7sMjNbN98g6vFUFpK45swuYrcmLHxMNA7exEYPVs4wbgz34djUj
Pause:       4xQCP55eJyAfWnik2uypdmiaRH1x9t54bXgYb5n1bNEQoW3gW294JpoxUghFbeSsPVPCqS4TYdUS2EGvxptoJhyK
Unpause:     2fCQZHjdEvzR57dCCdeD2fois4hPEdmjZUM82P2op65NoUDrNtffZip31E6P7d1mUMXnypMQRqRKZTnFt4iJdUfP
```

### SSS-2 Localnet Example

```text
SSS Program:  DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu
Hook Program: Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH
Initialize:   533Xi1MQPe4vQ8zP3XpAw2BwRkCwFnTf6SziGFEeYkB8Uw49wdW62F4tuuQAbfPkHz5a8VTpJnCmzQB2ENdpciaU
Init Hook:    4BVY3dT1WzXZ3ENL29am9vWThQtFJg1fXSyrwUtGzkVPgLtTvSEjYBh4rvxShNyrGtT1fTrnKEsCkhNrdUVnQyx4
Blacklist:    3yiWkxC22NFSpN3EkmNM9mrK3Ao7Rqjk6sLhpaxky8trMwWRCKQL9EnnWTsGgT7V3ciLBqntCR4Gwn6YRonSS2fx
Seize:        REwUV7x4jVFCeGbn47HHzRdC9D6nfCLvAGEhc2qq6B2cYxUBnhNJfxsW44LamUtK3vvR1xunukFcP4Kv4neH4Zs
Unblacklist:  4hLqK6yrT5SMdTF46Gb6oP9afeh224CsPJHoFsZjniGy9C9n75NqyYy5ASdfkzNySLzLUAwGrPA4Xvtd7iKW6Wg3
```

## Next Phase

When remote proof is needed again, regenerate this document from fresh devnet deployments and real explorer links. Until then, keep all validation local.
