# Error Code Reference

This document catalogs every custom error code across all SSS programs. Anchor maps each `#[error_code]` variant to a 6-digit number starting at `6000` for each program (offset from the Anchor base of `6000`). The table below lists the error name, code offset within the program, the triggering condition, and remediation steps.

When an instruction fails, the on-chain error log includes the program address, error code number, and the human-readable message. The TypeScript SDK surfaces these as `AnchorError` instances with `.error.errorCode.number` and `.error.errorMessage`.

---

## SSS Program (Core)

Program ID: `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu`

Anchor base offset: `6000`. Error code `6000 + N` where N is the variant index.

| Code | Name | Message | Thrown When | Remediation |
|------|------|---------|-------------|-------------|
| 6000 | `Unauthorized` | Unauthorized - caller lacks the required role | The instruction signer does not have the required `RoleAccount` PDA, or the PDA exists but `active = false` | Ensure the signer has been granted the required role via `update_roles`. Check that the `RoleAccount` PDA exists and is active. |
| 6001 | `Paused` | Stablecoin is paused | `mint_tokens` or `burn_tokens` called while `config.paused = true` | Wait for a Pauser to call `unpause`, or call `unpause` if you hold the Pauser role. |
| 6002 | `NotPaused` | Stablecoin is not paused | `unpause` called while `config.paused = false` | The stablecoin is already active. No action required. |
| 6003 | `QuotaExceeded` | Minter quota exceeded | `mint_tokens` would cause `minter_quota.minted + amount > minter_quota.quota` | Request a quota increase via `update_minter`, or mint a smaller amount. Check `minter_quota.minted` vs `minter_quota.quota`. |
| 6004 | `ZeroAmount` | Amount must be greater than zero | An instruction received `amount = 0` | Pass a positive non-zero amount. |
| 6005 | `NameTooLong` | Name exceeds maximum length | `name.len() > MAX_NAME_LEN (32)` during `initialize` | Shorten the name to 32 bytes or fewer. |
| 6006 | `SymbolTooLong` | Symbol exceeds maximum length | `symbol.len() > MAX_SYMBOL_LEN (10)` during `initialize` | Shorten the symbol to 10 bytes or fewer. |
| 6007 | `UriTooLong` | URI exceeds maximum length | `uri.len() > MAX_URI_LEN (200)` during `initialize` | Shorten the metadata URI to 200 bytes or fewer. |
| 6008 | `ReasonTooLong` | Reason exceeds maximum length | `reason.len() > MAX_REASON_LEN (64)` in `add_to_blacklist` | Shorten the blacklist reason string to 64 bytes or fewer. |
| 6009 | `InvalidRole` | Invalid role type | `role_type` passed to `update_roles` is not 0–4 | Use a valid role type: 0 (Minter), 1 (Burner), 2 (Pauser), 3 (Blacklister), 4 (Seizer). |
| 6010 | `ComplianceNotEnabled` | Compliance features not enabled on this stablecoin (SSS-1 config) | `add_to_blacklist`, `remove_from_blacklist`, or `seize` called on a stablecoin with `enable_transfer_hook = false` | These instructions require SSS-2 configuration. Re-initialize with `enable_transfer_hook = true` or use an SSS-2 preset. |
| 6011 | `PermanentDelegateNotEnabled` | Permanent delegate not enabled on this stablecoin | `seize` called on a stablecoin with `enable_permanent_delegate = false` | Re-initialize with `enable_permanent_delegate = true`. Seizure is an SSS-2 feature. |
| 6012 | `AlreadyBlacklisted` | Address is already blacklisted | `add_to_blacklist` called for an address that already has a `BlacklistEntry` PDA | Check current blacklist status before adding. The address is already restricted. |
| 6013 | `NotBlacklisted` | Address is not blacklisted | `remove_from_blacklist` called for an address with no `BlacklistEntry` PDA | The address is not on the blacklist. No action required. |
| 6014 | `MathOverflow` | Arithmetic overflow | A checked arithmetic operation (e.g., `checked_add`) returned `None` due to `u64` overflow | The supply or quota values have hit the `u64` maximum (`18_446_744_073_709_551_615`). Review the supply figures — this should not occur in practice with reasonable supply caps. |
| 6015 | `InvalidAuthority` | Invalid authority - not the master authority | An instruction requiring master authority was called by someone other than `config.master_authority` | Only the current `master_authority` can call `update_roles`, `update_minter`, `transfer_authority`, etc. Verify the signer keypair. |
| 6016 | `SameAuthority` | Cannot transfer authority to the same address | `transfer_authority` called with `new_authority == config.master_authority` | Provide a different public key as the new authority. |
| 6017 | `InvalidDecimals` | Invalid decimals - must be between 0 and 9 | `decimals > 9` during `initialize` | Use decimals in the range 0–9. Most stablecoins use 6. |
| 6018 | `InvalidConfig` | Invalid configuration: transfer hook requires a valid program ID | `enable_transfer_hook = true` but no valid `hook_program_id` was provided | Pass the transfer hook program ID when initializing with SSS-2 preset. |
| 6019 | `SupplyCapExceeded` | Global supply cap would be exceeded by this mint | `mint_tokens` would cause `total_minted + amount > supply_cap` (when `supply_cap > 0`) | Reduce the mint amount, increase the supply cap via `update_supply_cap`, or remove the cap by setting it to `0`. |
| 6020 | `PendingTransferExists` | An authority transfer is already in progress — cancel or accept first | `propose_authority_transfer` called while `config.pending_authority != Pubkey::default()` | Cancel the existing pending transfer via `cancel_authority_transfer`, or have the pending authority accept it via `accept_authority_transfer`. |
| 6021 | `NoPendingTransfer` | No authority transfer is in progress | `cancel_authority_transfer` or `accept_authority_transfer` called with no pending transfer | There is no in-flight authority transfer. Check `config.pending_authority`. |
| 6022 | `InvalidPendingAuthority` | Only the proposed pending authority may accept the transfer | `accept_authority_transfer` called by someone other than `config.pending_authority` | Only the address designated in `propose_authority_transfer` can complete the transfer. |

### Anchor Built-in Errors (SSS)

Anchor validates account constraints before custom logic runs. You may also encounter:

| Code | Name | Description |
|------|------|-------------|
| `3004` | `AccountNotInitialized` | A required PDA does not yet exist on-chain |
| `3010` | `AccountDidNotDeserialize` | Account data cannot be parsed (wrong account type passed) |
| `2003` | `ConstraintRaw` | An `#[account(constraint = ...)]` check failed |
| `2000` | `ConstraintMut` | A mutable account constraint failed |

---

## Transfer Hook Program

Program ID: `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH`

These errors are returned during `transfer_checked` when the blacklist enforcement fires. They cause the entire token transfer to be rejected and rolled back.

| Code | Name | Message | Thrown When | Remediation |
|------|------|---------|-------------|-------------|
| 6000 | `SourceBlacklisted` | Source address is blacklisted | The owner of the source token account has a `BlacklistEntry` PDA | The source owner is on the blacklist. A Blacklister must call `remove_from_blacklist` to lift the restriction. |
| 6001 | `DestinationBlacklisted` | Destination address is blacklisted | The owner of the destination token account has a `BlacklistEntry` PDA | The destination owner is on the blacklist. Same remediation as above. |
| 6002 | `InvalidExtraAccountMetas` | Invalid extra account metas | The `ExtraAccountMetas` PDA data is malformed or the wrong accounts were resolved | Re-initialize the extra account metas via `initialize_extra_account_metas`. This may indicate a version mismatch between the transfer hook program and the stored meta account. |

### Notes on Transfer Hook Errors

- The hook is called by Token-2022 on every `transfer_checked`. The caller sees only a generic "program error" — the specific error code is in the transaction logs.
- Seizure operations bypass the blacklist check: when the config PDA is the signer (permanent delegate), the hook skips the blacklist lookup to allow forced transfers.
- The `fallback` handler routes calls from Token-2022 using the discriminator `[105, 37, 101, 197, 75, 251, 102, 26]`.

---

## Oracle Program

Program ID: `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ`

| Code | Name | Message | Thrown When | Remediation |
|------|------|---------|-------------|-------------|
| 6000 | `Unauthorized` | Unauthorized - caller is not the oracle authority | An instruction requiring oracle authority was called by someone else | Use the keypair that was designated as `oracle_config.authority` during `initialize_oracle`. |
| 6001 | `InvalidAggregatorData` | Invalid aggregator account data - cannot parse Switchboard result | The Switchboard V2 aggregator account data is malformed or cannot be deserialized | Verify the aggregator account address is a valid active Switchboard V2 feed. |
| 6002 | `StalePrice` | Price data is stale - exceeds staleness threshold | The aggregator's latest price timestamp is older than `oracle_config.staleness_threshold` seconds | Crank the Switchboard feed to get a fresh price, or call `refresh_price` once the feed updates. |
| 6003 | `PriceOutOfBounds` | Price out of bounds - below minimum or above maximum | The aggregator price is outside `[min_price, max_price]` | Check whether the oracle feed is correct. If the peg has genuinely moved outside bounds, update `min_price`/`max_price` via `update_oracle_config`. |
| 6004 | `InvalidPrice` | Invalid price - must be positive | The aggregator returned zero or a negative price | This indicates a malfunction or manipulation of the Switchboard feed. Investigate the aggregator account. |
| 6005 | `ManualOverrideDisabled` | Manual override is disabled - use refresh_price with a Switchboard aggregator | `push_manual_price` called on an oracle config with `manual_override = false` | Enable manual override via `update_oracle_config` (only for testing/emergency use), or use `refresh_price` with the actual aggregator. |
| 6006 | `MathOverflow` | Arithmetic overflow | Price conversion overflowed `u64` | Check the price scale factor and decimal configuration. |
| 6007 | `CurrencyTooLong` | Currency identifier exceeds maximum length | The `base_currency` string exceeds 10 bytes | Use a shorter currency code (e.g., "USD", "EUR", "BRL"). |
| 6008 | `InvalidPriceBounds` | Invalid price bounds - min_price must be less than max_price | `min_price >= max_price` passed to `initialize_oracle` or `update_oracle_config` | Ensure `min_price < max_price`. Typical USD bounds: 980000 to 1020000 (with 6 decimals). |
| 6009 | `InvalidStaleness` | Invalid staleness threshold - must be greater than zero | `staleness_threshold = 0` | Use a positive staleness threshold in seconds. Typical value: 60. |
| 6010 | `AggregatorMismatch` | Aggregator mismatch - provided account does not match oracle config | `refresh_price` received an aggregator account different from `oracle_config.aggregator` | Pass the correct aggregator account address stored in the oracle config, or update the config if the feed address has changed. |

---

## Privacy Program (SSS-3)

Program ID: `Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk`

| Code | Name | Message | Thrown When | Remediation |
|------|------|---------|-------------|-------------|
| 6000 | `Unauthorized` | Unauthorized - caller is not the privacy authority | Instruction signer is not `privacy_config.authority` | Use the keypair designated as the privacy config authority. |
| 6001 | `AlreadyInitialized` | Privacy config already initialized for this stablecoin | `initialize_privacy` called for a stablecoin that already has a `PrivacyConfig` PDA | The privacy config is already set up. Use `update_privacy_config` to change settings. |
| 6002 | `AddressNotOnAllowlist` | Address is not on the allowlist | `remove_from_allowlist` called for an address with no `AllowlistEntry` PDA | The address was never added, or was already removed. |
| 6003 | `LabelTooLong` | Label exceeds maximum length of 32 bytes | `label.len() > 32` in `add_to_allowlist` | Shorten the label to 32 bytes or fewer. |
| 6004 | `ConfidentialTransfersNotEnabled` | Confidential transfers are not enabled on the stablecoin config | `initialize_privacy` called for a stablecoin with `enable_confidential_transfer = false` | The SSS stablecoin must be initialized with `enable_confidential_transfer = true` (SSS-3 preset) before creating a privacy config. |
| 6005 | `MathOverflow` | Arithmetic overflow | A checked arithmetic operation overflowed | Internal error; should not occur in normal operation. |

---

## Error Handling in TypeScript

```typescript
import { AnchorError } from "@coral-xyz/anchor";

try {
  await program.methods.mintTokens(new BN(1_000_000)).rpc();
} catch (err) {
  if (err instanceof AnchorError) {
    console.log("Error code:", err.error.errorCode.number);
    console.log("Error name:", err.error.errorCode.code);
    console.log("Error message:", err.error.errorMessage);
    console.log("Program:", err.program.toString());

    // Handle specific errors
    switch (err.error.errorCode.code) {
      case "QuotaExceeded":
        // Minter quota depleted — request quota increase
        break;
      case "Paused":
        // Wait for unpause
        break;
      case "SupplyCapExceeded":
        // Global cap hit
        break;
    }
  }
}
```

## Error Handling in Rust (CPI callers)

```rust
use anchor_lang::prelude::*;

// After a CPI that may fail:
let result = sss_program::cpi::mint_tokens(ctx, amount);
match result {
    Ok(_) => msg!("Mint succeeded"),
    Err(e) => {
        // e.to_string() contains the human-readable message
        msg!("Mint failed: {}", e);
        return Err(e);
    }
}
```

---

## Common Error Scenarios and Fixes

### "Unauthorized" on mint_tokens

1. Verify the signer has a `RoleAccount` PDA at `["role", config, 0, signer]`
2. Verify `role_account.active = true`
3. Verify the signer is calling with the correct keypair
4. Use `getAccountInfo` on the PDA to confirm it exists and is initialized

### "QuotaExceeded" on mint_tokens

```typescript
// Check remaining quota before minting
const quotaPda = PublicKey.findProgramAddressSync(
  [Buffer.from("minter_quota"), config.toBuffer(), minter.toBuffer()],
  SSS_PROGRAM_ID
)[0];
const quotaAccount = await program.account.minterQuota.fetch(quotaPda);
const remaining = quotaAccount.quota.sub(quotaAccount.minted);
console.log("Remaining quota:", remaining.toString());
```

### Transfer rejected with "SourceBlacklisted" or "DestinationBlacklisted"

The transfer hook fires for every `transfer_checked`. Check both the source owner and destination owner:

```typescript
const blacklistPda = PublicKey.findProgramAddressSync(
  [Buffer.from("blacklist"), config.toBuffer(), address.toBuffer()],
  SSS_PROGRAM_ID
)[0];
const exists = await connection.getAccountInfo(blacklistPda);
if (exists) {
  console.log("Address is blacklisted");
}
```
