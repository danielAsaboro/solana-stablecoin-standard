# Devnet Deployment

All four SSS programs are deployed and verified on Solana devnet.

## Program IDs (Devnet)

| Program | Address | Explorer |
|---------|---------|----------|
| SSS | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` | [View](https://explorer.solana.com/address/DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu?cluster=devnet) |
| Transfer Hook | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` | [View](https://explorer.solana.com/address/Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH?cluster=devnet) |
| Oracle | `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ` | [View](https://explorer.solana.com/address/6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ?cluster=devnet) |
| Privacy | `Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk` | [View](https://explorer.solana.com/address/Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk?cluster=devnet) |

## Deployment Transactions

| Program | Signature |
|---------|-----------|
| Transfer Hook | `2bVvsw4frDRdzm4eL8h8CzNsxRPNkUFXZzC4s2aBjjYYBM6aPpqFQY8KrzRKLJ1H3YjvRjSE1uogwQg9oDG5ankv` |
| Oracle | `4EngACyAVfHTJUTkNSrdEACcscvhtCrYgVMnw54Wx3ZLtRocmassJ78TH83KHrpB1FPXRUudA75pU9cVSGug3fF7` |
| Privacy | `4FBiLP1pxq5ha9ejycf5ZBk77pvrdL3ZftcCpfZ4GaP33ubTruBafb76ospVHwp1ppG2RumEGbPZ5XgyydSdWKK1` |
| SSS | `5fXVrL4e2gwXk9dtBpydVVeFoVMhqzqH5ZaohknjfzzMdUmKkZb593RiE3HY8X1bvjXFvsbkeAqEDM1zFiaSxmHw` |

## PDA Seeds

| PDA | Seeds |
|-----|-------|
| Config | `["stablecoin", mint]` |
| Role | `["role", config, role_type_u8, user]` |
| MinterQuota | `["minter_quota", config, minter]` |
| BlacklistEntry | `["blacklist", config, address]` |
| ExtraAccountMetas | `["extra-account-metas", mint]` |
| OracleConfig | `["oracle_config", stablecoin_config]` |
| PrivacyConfig | `["privacy_config", stablecoin_config]` |
| AllowlistEntry | `["allowlist", privacy_config, address]` |

## Local Verification

```bash
npm install
npm run build
npm test
```

`npm test` runs the full test suite via Surfpool (local mainnet fork):
- 141 Anchor integration tests
- 58 SDK unit tests
- 17 CLI smoke tests
- 53 backend tests
- 21 fuzz tests (~11,800 cases)
