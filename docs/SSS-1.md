# SSS-1: Minimal Stablecoin Standard

## Overview

SSS-1 is the minimal stablecoin preset. It provides the core functionality needed to operate a stablecoin on Solana without compliance features.

## Features

- Token-2022 mint with on-chain metadata
- Role-based access control (Minter, Burner, Pauser)
- Per-minter quota system
- Freeze/thaw individual token accounts
- Pause/unpause all minting and burning
- Authority transfer

## What SSS-1 Does NOT Include

- No permanent delegate (no forced seizure)
- No transfer hook (no blacklist enforcement on transfers)
- No Blacklister or Seizer roles

## Initialization

```typescript
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(connection, {
  name: "My Stablecoin",
  symbol: "MUSD",
  uri: "https://example.com/metadata.json",
  decimals: 6,
  enablePermanentDelegate: false,
  enableTransferHook: false,
  defaultAccountFrozen: false,
  authority: wallet.publicKey,
});
```

## Token-2022 Extensions

SSS-1 initializes only:
- **MetadataPointer** — points to the mint itself for on-chain metadata

## Roles

| Role | Type | Operations |
|------|------|------------|
| Minter | 0 | `mint_tokens` |
| Burner | 1 | `burn_tokens` |
| Pauser | 2 | `freeze`, `thaw`, `pause`, `unpause` |

## Quota System

Each minter has an independent `MinterQuota` PDA with:
- `quota` — maximum amount the minter can ever mint
- `minted` — cumulative amount minted so far

Minting fails if `minted + amount > quota`. Quotas can be increased by the master authority but the `minted` counter is never reset.

## Use Cases

- Internal test stablecoins
- Community tokens with supply management
- Simple fiat-pegged tokens without regulatory requirements
- Prototyping before upgrading to SSS-2
