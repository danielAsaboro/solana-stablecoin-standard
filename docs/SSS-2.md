# SSS-2: Compliant Stablecoin Standard

## Overview

SSS-2 extends SSS-1 with compliance features required by regulated stablecoin issuers. It adds on-chain blacklist enforcement via a transfer hook and forced seizure via the permanent delegate extension.

## Additional Features Over SSS-1

- **Permanent Delegate** — config PDA can transfer tokens from any account (seizure)
- **Transfer Hook** — every `transfer_checked` is validated against the blacklist
- **Blacklister Role** — can add/remove addresses from the on-chain blacklist
- **Seizer Role** — can seize tokens from any account to a designated treasury
- **BlacklistEntry PDAs** — on-chain record of blacklisted addresses with reason and timestamp

## Initialization

```typescript
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(connection, {
  name: "Compliant USD",
  symbol: "cUSD",
  uri: "https://example.com/metadata.json",
  decimals: 6,
  enablePermanentDelegate: true,
  enableTransferHook: true,
  defaultAccountFrozen: false,
  authority: wallet.publicKey,
  transferHookProgramId: TRANSFER_HOOK_PROGRAM_ID,
});
```

After initialization, the transfer hook's ExtraAccountMetas PDA must be initialized:
```typescript
await hookProgram.methods.initializeExtraAccountMetas()
  .accounts({ payer, extraAccountMetas, mint, sssProgram, systemProgram })
  .rpc();
```

## Roles

| Role | Type | Operations |
|------|------|------------|
| Minter | 0 | `mint_tokens` |
| Burner | 1 | `burn_tokens` |
| Pauser | 2 | `freeze`, `thaw`, `pause`, `unpause` |
| Blacklister | 3 | `add_to_blacklist`, `remove_from_blacklist` |
| Seizer | 4 | `seize` |

## Blacklist Mechanics

### Adding to Blacklist
Creates a `BlacklistEntry` PDA at `["blacklist", config, address]`:
- `reason` — human-readable justification (max 64 chars)
- `blacklisted_at` — Unix timestamp
- `blacklisted_by` — the Blacklister authority

### Transfer Enforcement
When a transfer is attempted:
1. Token-2022 reads the TransferHook extension from the mint
2. Resolves the ExtraAccountMetas PDA for extra accounts
3. CPIs to the transfer hook program with standard + extra accounts
4. Hook checks `BlacklistEntry` PDAs for source owner and destination owner
5. If either PDA exists and has data → transfer rejected
6. If neither exists → transfer proceeds normally

### Removing from Blacklist
Closes the `BlacklistEntry` PDA and returns rent to the authority.

## Seize Mechanics

The seize instruction uses the permanent delegate extension:
1. Verify the caller has the Seizer role
2. CPI `transfer_checked` with the config PDA as the delegate signer
3. Tokens move from the source account to the destination (treasury)
4. The source owner does not need to sign

## Feature Gating

SSS-2 instructions fail gracefully on SSS-1 configs:
- On-chain: `require!(config.enable_transfer_hook, StablecoinError::ComplianceNotEnabled)`
- SDK: checks config state before building transactions
- CLI: catches the error and suggests using `--preset sss-2`

## Regulatory Alignment

SSS-2 is designed with regulatory frameworks in mind:
- **Blacklist** — addresses sanctions/AML requirements
- **Seize** — enables court-ordered asset recovery
- **Audit trail** — all operations emit events for compliance reporting
- **Role separation** — different entities can hold different roles
