# Solana Ecosystem Knowledge

## Token Standards

### SPL Token (Original)
- Basic mint/transfer/burn
- Associated Token Accounts (ATA)
- No extensions

### Token-2022 (Token Extensions)
The standard for SSS. Key extensions used:

| Extension | SSS Usage |
|-----------|-----------|
| MintCloseAuthority | Config PDA can close empty mints |
| PermanentDelegate | Config PDA can seize tokens (SSS-2) |
| TransferHook | Routes to hook program for blacklist check (SSS-2) |
| MetadataPointer | On-chain stablecoin branding |
| ConfidentialTransfer | Encrypted balances with ZK proofs (SSS-3) |

### Extension Composition Rules
- Most extensions can be combined freely
- **ConfidentialTransfer + TransferHook is INCOMPATIBLE** in Token-2022
- SSS-3 uses account approval gating instead of transfer hooks
- Extensions must be initialized before first mint

## DeFi Primitives

### Stablecoins on Solana
- USDC (Circle) - centralized mint, Token-2022
- PYUSD (PayPal) - Token-2022 with extensions
- UXD - algorithmic (deprecated)
- SSS brings standardized compliance tooling

### Oracles
- **Switchboard V2** - SSS oracle module uses this for price feeds
- **Pyth** - Alternative oracle, not currently integrated
- Staleness checks critical for mint operations on non-USD pegs

## Infrastructure

### Validator / Test Infrastructure
- **Surfpool** - SSS testing infrastructure, mainnet fork
- **solana-test-validator** - Standard local validator
- **LiteSVM** - Lightweight SVM for fast tests
- **Mollusk** - Fastest unit test framework

### Indexing
- Events emitted by SSS programs can be indexed by:
  - Helius webhooks
  - Custom geyser plugins
  - RPC `getTransaction` with log parsing

## Stablecoin Regulatory Landscape

### GENIUS Act (US)
- Requires: freeze, pause, authorized minting, sanctions compliance
- SSS-2 provides full coverage

### MiCA (EU)
- Requires: reserve transparency, redemption rights
- SSS oracle module supports reserve ratio validation

### Brazil (BCB)
- Digital asset framework emerging
- SSS oracle module supports BRL-pegged stablecoins via Switchboard
