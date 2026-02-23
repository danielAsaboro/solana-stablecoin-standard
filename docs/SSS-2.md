# SSS-2: Compliant Stablecoin Standard

| Field | Value |
|---|---|
| Standard | SSS-2 |
| Title | Compliant Stablecoin — Blacklist Enforcement and Seizure |
| Status | Final |
| Requires | SSS-1 |
| Programs | `sss` (main), `transfer_hook` (enforcement) |
| Token Standard | Token-2022 |

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Motivation](#2-motivation)
3. [Specification](#3-specification)
4. [Instructions](#4-instructions)
   - [4.1 add_to_blacklist](#41-add_to_blacklist)
   - [4.2 remove_from_blacklist](#42-remove_from_blacklist)
   - [4.3 seize](#43-seize)
5. [Transfer Hook Program](#5-transfer-hook-program)
   - [5.1 initialize_extra_account_metas](#51-initialize_extra_account_metas)
   - [5.2 transfer_hook_execute / fallback](#52-transfer_hook_execute--fallback)
   - [5.3 Extra Account Resolution](#53-extra-account-resolution)
   - [5.4 Blacklist Check Logic](#54-blacklist-check-logic)
   - [5.5 Seizure Bypass](#55-seizure-bypass)
6. [Feature Gating](#6-feature-gating)
7. [Blacklist System](#7-blacklist-system)
8. [Seizure System](#8-seizure-system)
9. [Events](#9-events)
10. [Error Codes](#10-error-codes)
11. [Role System Extensions](#11-role-system-extensions)
12. [Security Properties](#12-security-properties)
13. [Regulatory Alignment](#13-regulatory-alignment)
14. [Initialization Guide](#14-initialization-guide)
15. [SDK Usage](#15-sdk-usage)
16. [Migration from SSS-1](#16-migration-from-sss-1)
17. [Use Cases](#17-use-cases)

---

## 1. Abstract

SSS-2 (Compliant Stablecoin Standard) extends SSS-1 with two Token-2022 extensions — **PermanentDelegate** and **TransferHook** — and three on-chain enforcement mechanisms: a blacklist managed by a dedicated Blacklister role, a transfer hook program that rejects transfers involving blacklisted addresses on every `transfer_checked` call, and a forced seizure instruction that uses the PermanentDelegate extension to move tokens from any account without the owner's consent. These capabilities are designed for regulated stablecoin issuers subject to OFAC sanctions enforcement, AML obligations, and court-ordered asset recovery.

---

## 2. Motivation

### Regulatory Context

Regulated stablecoins operating in most jurisdictions must implement controls that vanilla SPL Token and SSS-1 do not provide:

- **OFAC sanctions compliance**: The U.S. Office of Foreign Assets Control publishes a Specially Designated Nationals (SDN) list. Issuers must block transactions involving sanctioned addresses at the protocol level, not just the application layer.
- **AML (Anti-Money Laundering)**: Financial institutions must be able to freeze and seize assets tied to investigated transactions. This requires a mechanism to confiscate tokens from any account, even without the holder's cooperation.
- **Court-ordered recovery**: Judicial orders sometimes mandate asset recovery. A programmatic seizure mechanism backed by the on-chain token itself (not an application bridge) satisfies these requirements.

Application-level enforcement (e.g., blocking at API gateways) is insufficient for on-chain tokens: any wallet can call `transfer_checked` directly, bypassing application controls. SSS-2 closes this gap by enforcing blacklist checks at the Token-2022 instruction level.

### What SSS-2 Adds Over SSS-1

| Capability | SSS-1 | SSS-2 |
|---|---|---|
| Mint / Burn | Yes | Yes |
| Pause | Yes | Yes |
| Freeze / Thaw individual accounts | Yes | Yes |
| Role-based access control | Yes | Yes |
| On-chain blacklist | No | Yes |
| Transfer-level blacklist enforcement | No | Yes |
| Forced seizure (no owner consent) | No | Yes |
| Audit trail for compliance operations | No | Yes |
| PermanentDelegate extension | No | Yes |
| TransferHook extension | No | Yes |

---

## 3. Specification

### 3.1 Program IDs

| Program | ID (Localnet) | Purpose |
|---|---|---|
| `sss` | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` | Main stablecoin program — blacklist management and seizure |
| `transfer_hook` | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` | Enforcement — called by Token-2022 on every transfer |

Production deployments will have different program IDs. All PDA derivations use the program ID of the deployed instance.

### 3.2 Account Layout

#### StablecoinConfig (shared with SSS-1)

The `StablecoinConfig` PDA is the central state account. SSS-2 makes use of three feature flags that are always present in the struct but only active when the config is initialized as SSS-2.

```
Seeds: ["stablecoin", mint_pubkey]
Owner:  sss program
```

| Field | Type | Bytes | Description |
|---|---|---|---|
| discriminator | `[u8; 8]` | 8 | Anchor account discriminator |
| mint | `Pubkey` | 32 | Token-2022 mint address |
| name | `String` | 4 + up to 32 | Human-readable name |
| symbol | `String` | 4 + up to 10 | Token symbol |
| uri | `String` | 4 + up to 200 | Metadata URI |
| decimals | `u8` | 1 | Decimal places (0–9) |
| master_authority | `Pubkey` | 32 | Master authority for role management |
| enable_permanent_delegate | `bool` | 1 | **SSS-2**: Permanent delegate extension active |
| enable_transfer_hook | `bool` | 1 | **SSS-2**: Transfer hook extension active |
| default_account_frozen | `bool` | 1 | New token accounts start frozen |
| enable_confidential_transfer | `bool` | 1 | SSS-3: Confidential transfers active |
| paused | `bool` | 1 | Whether the stablecoin is paused |
| total_minted | `u64` | 8 | Cumulative tokens minted (lifetime) |
| total_burned | `u64` | 8 | Cumulative tokens burned (lifetime) |
| transfer_hook_program | `Pubkey` | 32 | Hook program ID (if enabled) |
| bump | `u8` | 1 | PDA bump seed |
| _reserved | `[u8; 63]` | 63 | Reserved for future use |

Total account size: **396 bytes** (including Anchor discriminator and maximum-length strings).

#### BlacklistEntry (SSS-2 only)

One PDA per blacklisted address per stablecoin config.

```
Seeds: ["blacklist", config_pubkey, address_pubkey]
Owner:  sss program
```

| Field | Type | Bytes | Description |
|---|---|---|---|
| discriminator | `[u8; 8]` | 8 | Anchor account discriminator |
| config | `Pubkey` | 32 | The StablecoinConfig this entry belongs to |
| address | `Pubkey` | 32 | The blacklisted wallet or program address |
| reason | `String` | 4 + up to 64 | Human-readable justification (e.g., "OFAC SDN match") |
| blacklisted_at | `i64` | 8 | Unix timestamp of blacklisting (from `Clock::unix_timestamp`) |
| blacklisted_by | `Pubkey` | 32 | The Blacklister authority who created this entry |
| bump | `u8` | 1 | PDA bump seed |

Total account size: **177 bytes**.

The existence of a `BlacklistEntry` PDA at the correct address is the enforcement signal. The transfer hook does not deserialize the account; it checks whether the account has data and is owned by the SSS program.

#### ExtraAccountMetaList (Transfer Hook program)

```
Seeds: ["extra-account-metas", mint_pubkey]
Owner:  transfer_hook program
```

Stores the TLV-encoded account resolution recipe used by Token-2022 to derive the extra accounts passed to the hook on each transfer. Created once per mint by `initialize_extra_account_metas`. This account is not directly readable by application code; its format is defined by the SPL TLV Account Resolution library.

### 3.3 Feature Flags

SSS-2 is characterized by two boolean flags stored in `StablecoinConfig` that are set at initialization and are **immutable thereafter**:

| Flag | Field | Required For |
|---|---|---|
| `enable_transfer_hook` | `StablecoinConfig::enable_transfer_hook` | Blacklist operations (`add_to_blacklist`, `remove_from_blacklist`) |
| `enable_permanent_delegate` | `StablecoinConfig::enable_permanent_delegate` | Seizure (`seize`) |

`default_account_frozen` is optional and orthogonal to compliance — when `true`, newly created associated token accounts are initialized in the frozen state, requiring a Pauser to thaw them before the holder can receive tokens.

### 3.4 PDA Derivations

All PDAs use `find_program_address` with canonical bump (the first valid bump found by decreasing from 255).

| Account | Seeds | Program |
|---|---|---|
| StablecoinConfig | `["stablecoin", mint]` | `sss` |
| RoleAccount | `["role", config, role_type_u8, user]` | `sss` |
| MinterQuota | `["minter_quota", config, minter]` | `sss` |
| BlacklistEntry | `["blacklist", config, address]` | `sss` |
| ExtraAccountMetaList | `["extra-account-metas", mint]` | `transfer_hook` |

Derivation example in TypeScript:

```typescript
import { PublicKey } from "@solana/web3.js";

// BlacklistEntry PDA
const [blacklistEntry] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("blacklist"),
    configAddress.toBuffer(),
    suspectAddress.toBuffer(),
  ],
  SSS_PROGRAM_ID
);

// ExtraAccountMetaList PDA
const [extraAccountMetas] = PublicKey.findProgramAddressSync(
  [Buffer.from("extra-account-metas"), mintAddress.toBuffer()],
  TRANSFER_HOOK_PROGRAM_ID
);
```

### 3.5 Token-2022 Extensions Added by SSS-2

SSS-2 mints include two additional Token-2022 extensions beyond what SSS-1 uses.

#### PermanentDelegate

The `PermanentDelegate` extension designates an account as a permanent delegate with authority to transfer tokens from any token account associated with this mint, without owner approval. In SSS-2, the delegate is set to the `StablecoinConfig` PDA.

The config PDA is a program-derived address — no private key exists that can sign transactions for it directly. The SSS program's `seize` instruction uses `invoke_signed` with the config's seeds to act as the delegate.

#### TransferHook

The `TransferHook` extension stores a program ID in the mint. Token-2022 CPIs into that program on every `transfer_checked` call before the transfer settles. The hook authority is also the `StablecoinConfig` PDA.

The hook program is specified at initialization time via `transfer_hook_program_id`. The program stored in the extension must match the deployed `transfer_hook` program ID.

**Initialization order for extensions** (enforced by Token-2022):

1. `initialize_permanent_delegate` — before `initialize_mint2`
2. `initialize_transfer_hook` — before `initialize_mint2`
3. `initialize_metadata_pointer` — before `initialize_mint2`
4. `initialize_mint2` — sets mint authority and freeze authority to config PDA
5. `initialize_token_metadata` — writes name/symbol/URI on-chain

---

## 4. Instructions

### 4.1 add_to_blacklist

Creates a `BlacklistEntry` PDA that the transfer hook will detect on subsequent transfers.

#### Accounts

| # | Name | Writable | Signer | Description |
|---|---|---|---|---|
| 0 | `authority` | Yes | Yes | The Blacklister executing the operation |
| 1 | `config` | No | No | StablecoinConfig PDA for the mint |
| 2 | `role_account` | No | No | RoleAccount PDA confirming authority holds Blacklister role |
| 3 | `blacklist_entry` | Yes | No | BlacklistEntry PDA to be created (must not already exist) |
| 4 | `system_program` | No | No | System program for account creation |

#### Parameters

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `address` | `Pubkey` | Any valid pubkey | The wallet or program address to blacklist |
| `reason` | `String` | Max 64 bytes | Human-readable justification for the blacklisting |

#### Validation Rules

1. `config.enable_transfer_hook` must be `true`; otherwise returns `ComplianceNotEnabled`.
2. The `role_account` PDA must match seeds `["role", config, ROLE_BLACKLISTER (3), authority]`; Anchor validates via seeds constraint.
3. `role_account.active` must be `true`; otherwise returns `Unauthorized`.
4. `blacklist_entry` must not already exist. The instruction uses `init` (not `init_if_needed`), so Anchor returns an account-already-in-use error if the PDA is already initialized. This prevents double-blacklisting without a custom error.
5. `reason.len()` must be ≤ 64 bytes; otherwise returns `ReasonTooLong`.

#### State Changes

- A new `BlacklistEntry` account is created at `["blacklist", config, address]` and populated:
  - `config` ← `config.key()`
  - `address` ← instruction parameter `address`
  - `reason` ← instruction parameter `reason`
  - `blacklisted_at` ← `Clock::get()?.unix_timestamp`
  - `blacklisted_by` ← `authority.key()`
  - `bump` ← canonical bump from PDA derivation

#### Emitted Event

`AddressBlacklisted { config, address, reason, blacklisted_by }`

#### Errors

| Error | Code | Condition |
|---|---|---|
| `ComplianceNotEnabled` | 6010 | `config.enable_transfer_hook == false` |
| `Unauthorized` | 6000 | `role_account.active == false` |
| `ReasonTooLong` | 6008 | `reason.len() > 64` |
| Anchor `AccountAlreadyInUse` | — | `blacklist_entry` PDA already initialized |

---

### 4.2 remove_from_blacklist

Closes the `BlacklistEntry` PDA, returning rent to the authority and immediately lifting transfer restrictions for the address.

#### Accounts

| # | Name | Writable | Signer | Description |
|---|---|---|---|---|
| 0 | `authority` | Yes | Yes | The Blacklister executing the operation (receives rent) |
| 1 | `config` | No | No | StablecoinConfig PDA for the mint |
| 2 | `role_account` | No | No | RoleAccount PDA confirming authority holds Blacklister role |
| 3 | `blacklist_entry` | Yes | No | BlacklistEntry PDA to be closed |

#### Parameters

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `address` | `Pubkey` | Must match an existing BlacklistEntry | The address to remove from the blacklist |

#### Validation Rules

1. `config.enable_transfer_hook` must be `true`; otherwise returns `ComplianceNotEnabled`.
2. The `role_account` PDA must match seeds `["role", config, ROLE_BLACKLISTER (3), authority]`.
3. `role_account.active` must be `true`; otherwise returns `Unauthorized`.
4. The `blacklist_entry` PDA must exist and match seeds `["blacklist", config, address]`. If the PDA does not exist, Anchor returns an account-not-found error.
5. `blacklist_entry.config` must equal `config.key()` (additional on-chain constraint to prevent cross-config manipulation).

#### State Changes

- The `BlacklistEntry` account at `["blacklist", config, address]` is closed via `close = authority`.
- Rent-exempt lamports are transferred to `authority`.
- After this instruction, the PDA has zero lamports and no data. Subsequent transfers involving this address will pass the hook's blacklist check (the account appears as uninitialized).

#### Emitted Event

`AddressUnblacklisted { config, address, removed_by }`

#### Errors

| Error | Code | Condition |
|---|---|---|
| `ComplianceNotEnabled` | 6010 | `config.enable_transfer_hook == false` |
| `Unauthorized` | 6000 | `role_account.active == false` |
| Anchor account error | — | `blacklist_entry` PDA does not exist or has wrong seeds |

---

### 4.3 seize

Transfers tokens from any source token account to a destination token account using the config PDA as the permanent delegate. The source account owner does not need to sign.

#### Accounts

| # | Name | Writable | Signer | Description |
|---|---|---|---|---|
| 0 | `authority` | No | Yes | The Seizer executing the operation |
| 1 | `config` | No | No | StablecoinConfig PDA (used as permanent delegate signer via `invoke_signed`) |
| 2 | `role_account` | No | No | RoleAccount PDA confirming authority holds Seizer role |
| 3 | `mint` | No | No | Token-2022 mint (`config.mint`) |
| 4 | `from_token_account` | Yes | No | Source token account to seize from |
| 5 | `to_token_account` | Yes | No | Destination token account (e.g., treasury) |
| 6 | `token_program` | No | No | Token-2022 program (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` or Token-2022 ID) |
| `remaining_accounts` | varies | No | No | Transfer hook extra accounts (see Section 5.3) |

#### Parameters

| Parameter | Type | Constraints | Description |
|---|---|---|---|
| `amount` | `u64` | > 0 | Number of tokens to seize (base units, not UI units) |

#### Validation Rules

1. `config.enable_permanent_delegate` must be `true`; otherwise returns `PermanentDelegateNotEnabled`.
2. The `role_account` PDA must match seeds `["role", config, ROLE_SEIZER (4), authority]`.
3. `role_account.active` must be `true`; otherwise returns `Unauthorized`.
4. `amount` must be > 0; otherwise returns `ZeroAmount`.
5. `from_token_account.mint` must equal `config.mint` (enforced by `token::mint = mint` constraint).
6. `to_token_account.mint` must equal `config.mint` (enforced by `token::mint = mint` constraint).

#### State Changes

- Tokens are transferred from `from_token_account` to `to_token_account` via a `transfer_checked` CPI signed by the config PDA (permanent delegate).
- Token-2022 invokes the transfer hook during this CPI. The hook detects the config PDA as the `owner_delegate` and allows the transfer unconditionally, bypassing blacklist checks (see Section 5.5).
- No `StablecoinConfig` fields are mutated by this instruction.

#### Implementation Note

The `seize` instruction builds the `transfer_checked` instruction manually using `spl_token_2022::instruction::transfer_checked` and calls `invoke_signed` directly. This is necessary because Anchor's `token_interface::transfer_checked` helper does not forward `remaining_accounts` to the CPI, which would prevent Token-2022 from resolving the transfer hook's `ExtraAccountMetaList`.

The instruction appends all `remaining_accounts` to the instruction's account metas before calling `invoke_signed`:

```rust
for remaining in ctx.remaining_accounts.iter() {
    ix.accounts.push(AccountMeta {
        pubkey: *remaining.key,
        is_signer: remaining.is_signer,
        is_writable: remaining.is_writable,
    });
}
```

#### Emitted Event

`TokensSeized { config, from, to, amount, seized_by }`

#### Errors

| Error | Code | Condition |
|---|---|---|
| `PermanentDelegateNotEnabled` | 6011 | `config.enable_permanent_delegate == false` |
| `Unauthorized` | 6000 | `role_account.active == false` |
| `ZeroAmount` | 6004 | `amount == 0` |
| Token-2022 error | — | Insufficient balance in `from_token_account` |

---

## 5. Transfer Hook Program

The transfer hook program (`transfer_hook`) is a separate Anchor program that the `sss` program references. Token-2022 calls it on every `transfer_checked` for SSS-2 mints.

### 5.1 initialize_extra_account_metas

One-time setup instruction that creates the `ExtraAccountMetaList` PDA storing the account resolution recipe.

#### Accounts

| # | Name | Writable | Signer | Description |
|---|---|---|---|---|
| 0 | `payer` | Yes | Yes | Pays for PDA creation |
| 1 | `extra_account_metas` | Yes | No | ExtraAccountMetaList PDA to be created |
| 2 | `mint` | No | No | Token-2022 mint this hook is associated with |
| 3 | `sss_program` | No | No | SSS main program ID (for PDA derivation encoding) |
| 4 | `system_program` | No | No | System program for account creation |

#### Parameters

None.

#### Behavior

The instruction encodes a list of four extra accounts into the `ExtraAccountMetaList` PDA using the SPL TLV Account Resolution format. The encoded recipe instructs Token-2022 to derive these accounts dynamically at transfer time:

1. **Index 5**: SSS program — static pubkey, read-only, not a signer.
2. **Index 6**: StablecoinConfig PDA — derived from `["stablecoin", mint]` on the SSS program.
3. **Index 7**: Source owner's BlacklistEntry PDA — derived from `["blacklist", config, source_token_account.owner]` on the SSS program. The owner field is read from offset 32 of the source token account data.
4. **Index 8**: Destination owner's BlacklistEntry PDA — derived from `["blacklist", config, dest_token_account.owner]` on the SSS program. The owner field is read from offset 32 of the destination token account data.

Indices 0–4 are the standard SPL Transfer Hook accounts provided by Token-2022 at runtime and are not part of the encoded recipe.

This instruction must be called **once per mint** after the SSS `initialize` instruction has configured the transfer hook extension.

---

### 5.2 transfer_hook_execute / fallback

Token-2022 calls the transfer hook program using the SPL Transfer Hook Interface discriminator `[105, 37, 101, 197, 75, 251, 102, 26]`. This discriminator does not match Anchor's auto-generated discriminator for any named instruction, so Anchor would normally return `InstructionFallbackNotFound`.

The program implements a `fallback` entry point that:

1. Checks whether the incoming instruction data begins with the SPL discriminator.
2. If it matches, parses the `amount` (bytes 8–15, little-endian `u64`) from the instruction data.
3. Delegates to `execute_transfer_hook` — the same logic as the Anchor-dispatched `transfer_hook_execute` handler.

Both entry points (`transfer_hook_execute` for Anchor clients, `fallback`/`execute_transfer_hook` for Token-2022 runtime CPIs) run the same enforcement logic.

The `transfer_hook_execute` Anchor instruction is useful for testing and simulation; actual enforcement at runtime goes through the `fallback` path.

---

### 5.3 Extra Account Resolution

When Token-2022 processes a `transfer_checked` on an SSS-2 mint, it:

1. Reads the `TransferHook` extension from the mint to find the hook program ID.
2. Derives the `ExtraAccountMetaList` PDA at `["extra-account-metas", mint]` on the hook program.
3. Reads the TLV-encoded recipe from the PDA.
4. Resolves each extra account using the encoded seeds and the accounts already available (source token account, mint, destination token account, source owner/delegate, ExtraAccountMetas PDA).
5. Appends the resolved accounts to the CPI call into the hook program.

The complete account list presented to the hook program on every transfer is:

| Index | Account | Source | Description |
|---|---|---|---|
| 0 | `source_token` | Token-2022 | Source token account |
| 1 | `mint` | Token-2022 | Token-2022 mint |
| 2 | `destination_token` | Token-2022 | Destination token account |
| 3 | `owner_delegate` | Token-2022 | Source token account owner or delegate |
| 4 | `extra_account_metas` | Token-2022 | ExtraAccountMetaList PDA on hook program |
| 5 | `sss_program` | Encoded (static) | SSS main program ID |
| 6 | `config` | Encoded (PDA) | StablecoinConfig PDA on SSS program |
| 7 | `source_blacklist` | Encoded (PDA) | BlacklistEntry PDA for source owner |
| 8 | `dest_blacklist` | Encoded (PDA) | BlacklistEntry PDA for destination owner |

Accounts at index 7 and 8 may or may not exist on-chain. If they do not exist (the address is not blacklisted), they appear as uninitialized accounts with no data. If they do exist, they were created by `add_to_blacklist` and are owned by the SSS program.

---

### 5.4 Blacklist Check Logic

The hook checks accounts at indices 7 and 8 using the following test:

```
is_blacklisted(account) = !account.data_is_empty()
                        && account.owner != system_program
```

An account is considered blacklisted if and only if it has data AND is owned by a program other than the system program. An uninitialized PDA (account with no data, owned by the system program) is treated as not blacklisted.

This approach avoids deserializing the account data. The check is O(1) and does not require loading the full `BlacklistEntry` struct. The ownership check (`account.owner != system_program`) ensures that accounts that happen to share the same derived address by coincidence — but that were not created by the SSS program — do not falsely trigger a block.

The enforcement sequence is:

1. Check for seizure bypass (see Section 5.5).
2. Check `source_blacklist` (account at index 7): if blacklisted, return `SourceBlacklisted`.
3. Check `dest_blacklist` (account at index 8): if blacklisted, return `DestinationBlacklisted`.
4. Neither party is blacklisted — return `Ok(())`.

The hook does not check whether the stablecoin is paused. Pause enforcement is handled by the SSS program's mint and burn instructions.

---

### 5.5 Seizure Bypass

When the `seize` instruction executes a `transfer_checked` CPI, the `owner_delegate` presented to the hook (account at index 3) is the `StablecoinConfig` PDA — the permanent delegate. The hook detects this case and allows the transfer unconditionally.

**Detection logic** (identical in both `handler` and `execute_transfer_hook`):

```rust
let (expected_config, _) = Pubkey::find_program_address(
    &[b"stablecoin", mint.key.as_ref()],
    sss_program.key,
);
if owner_delegate.key == &expected_config {
    return Ok(()); // Seizure by permanent delegate — allow
}
```

The hook recomputes the expected config PDA from the mint (standard account index 1) and the SSS program ID (extra account index 5). If the `owner_delegate` matches this PDA, the transfer is classified as a seizure and all blacklist checks are skipped.

This means an operator with the Seizer role can move tokens from a blacklisted source account to a treasury, completing asset recovery even when the source would ordinarily be blocked.

---

## 6. Feature Gating

SSS-2 instructions are feature-gated at the on-chain level. Calling an SSS-2 instruction against a config that was initialized without the relevant feature flag returns an error immediately, before any state changes occur.

| Instruction | Required Flag | Error When Missing |
|---|---|---|
| `add_to_blacklist` | `config.enable_transfer_hook == true` | `ComplianceNotEnabled` (6010) |
| `remove_from_blacklist` | `config.enable_transfer_hook == true` | `ComplianceNotEnabled` (6010) |
| `seize` | `config.enable_permanent_delegate == true` | `PermanentDelegateNotEnabled` (6011) |

The Anchor constraint syntax:

```rust
constraint = config.enable_transfer_hook @ StablecoinError::ComplianceNotEnabled
constraint = config.enable_permanent_delegate @ StablecoinError::PermanentDelegateNotEnabled
```

These constraints are evaluated during account deserialization before the instruction handler body runs.

The transfer hook program (`transfer_hook`) is only ever invoked by Token-2022 on mints that have the `TransferHook` extension set. If a mint was initialized without `enable_transfer_hook`, the extension is not present and the hook program is never called.

**SDK-level gating**: The `SolanaStablecoin.compliance` module checks `config.enableTransferHook` and `config.enablePermanentDelegate` before building compliance transactions, providing a client-side pre-check before submitting to the network.

**CLI-level gating**: The `sss-token` CLI catches `ComplianceNotEnabled` and `PermanentDelegateNotEnabled` errors and suggests re-deploying with `--preset sss-2`.

---

## 7. Blacklist System

### PDA Lifecycle

```
add_to_blacklist                    remove_from_blacklist
        │                                    │
        ▼                                    ▼
  [creates PDA]                       [closes PDA]
BlacklistEntry                    (account zeroed,
at ["blacklist",                   rent returned
  config, address]                 to authority)
```

A `BlacklistEntry` PDA exists in one of two observable states:

- **Exists** (`data.len() > 0`, `owner == sss_program`): The address is blacklisted. Transfers will be blocked.
- **Does not exist** (account uninitialized, `owner == system_program`): The address is not blacklisted.

There is no "suspended" or "pending" state — the PDA either exists or it does not.

### Enforcement Coverage

The transfer hook enforces the blacklist on:

- **User-initiated transfers**: Any wallet calling `transfer_checked` directly against the Token-2022 mint.
- **Delegated transfers**: Transfers by approved delegates (`approve` + `transfer_checked`) are also intercepted; the hook checks the *owner* of the token account, not the delegate.
- **Program-initiated transfers**: Any CPI that calls `transfer_checked` on the SSS-2 mint routes through the hook.

The blacklist does **not** prevent:

- The Seizer (via the permanent delegate bypass described in Section 5.5).
- Closing token accounts (not a `transfer_checked` call).
- Burning tokens if the Burner has an active role and calls `burn_tokens` directly on the SSS program. The `burn_tokens` instruction does not go through `transfer_checked`.

### Audit Trail

Every blacklist modification emits an on-chain event (see Section 9). These events are indexed in the SSS backend API and can be queried via the `/api/audit-log` endpoint. The `BlacklistEntry` PDA itself stores the `reason`, `blacklisted_at` timestamp, and `blacklisted_by` authority, providing an immutable on-chain record for regulatory audits even before the PDA is closed.

When a PDA is closed by `remove_from_blacklist`, the on-chain PDA data is gone, but the `AddressUnblacklisted` event remains in the transaction history and the `AddressBlacklisted` event from the original blacklisting is also permanently on-chain.

### Multiple Stablecoins

Blacklists are scoped per stablecoin: `["blacklist", config, address]`. Blacklisting an address on one SSS-2 stablecoin has no effect on another. Issuers operating multiple stablecoins must manage each blacklist independently.

---

## 8. Seizure System

### How the Permanent Delegate Works

The Token-2022 `PermanentDelegate` extension stores one pubkey in the mint that is authorized to call `transfer_checked` from any token account associated with this mint, without the account owner's consent. The delegate cannot be changed after mint initialization.

In SSS-2, the permanent delegate is the `StablecoinConfig` PDA. Because this is a program-derived address with no associated private key, only the `sss` program can act as this delegate — specifically, only the `seize` instruction, which calls `invoke_signed` with the config's seeds.

This architecture ensures that:

- No individual key holder can seize tokens unilaterally (they must have the Seizer role AND submit a valid on-chain transaction through the SSS program).
- The seizure mechanism cannot be bypassed by the master authority or any other role — only an active Seizer role holder can invoke `seize`.

### Seizure Flow

```
Seizer (authority)
       │
       │ signs transaction
       ▼
  sss::seize instruction
       │
       │ validates role_account (Seizer role, active)
       │ validates config.enable_permanent_delegate
       │ validates amount > 0
       │
       │ invoke_signed(transfer_checked, signer_seeds = config PDA seeds)
       ▼
  Token-2022 transfer_checked
       │
       │ processes PermanentDelegate extension
       │ config PDA is delegate → transfer authorized
       │
       │ TransferHook extension → CPI to transfer_hook program
       ▼
  transfer_hook::execute_transfer_hook
       │
       │ owner_delegate == config PDA → seizure bypass → Ok(())
       ▼
  Token-2022 settles transfer
       │
       ▼
  sss::seize emits TokensSeized event
```

### Treasury Pattern

The conventional use is to seize to a dedicated treasury token account whose owner is the master authority or a multisig. The `to_token_account` parameter accepts any token account for the same mint — the program does not require it to be a specific treasury address. Issuers should document their treasury address in their compliance procedures.

### Transfer Hook Resolution During Seize

When `seize` calls `transfer_checked` via `invoke_signed`, Token-2022 processes the `TransferHook` extension and CPIs into the hook program. The `remaining_accounts` passed to `seize` must contain the hook's extra accounts in the correct order:

```
remaining_accounts[0]: sss_program
remaining_accounts[1]: config PDA
remaining_accounts[2]: source_blacklist PDA  (for source_token_account.owner)
remaining_accounts[3]: dest_blacklist PDA    (for to_token_account.owner)
remaining_accounts[4]: transfer_hook program
remaining_accounts[5]: extra_account_metas PDA
```

The SDK's `SeizeBuilder` resolves these automatically using `addExtraAccountMetasForExecute` from the SPL Transfer Hook interface library. When using the program directly, callers must pass all six accounts in this order.

---

## 9. Events

All SSS-2 state-changing instructions emit exactly one Anchor event. Events are encoded in the transaction logs as base64 under the `Program data:` prefix.

### SSS-2 Specific Events

| Event | Instruction | Fields |
|---|---|---|
| `AddressBlacklisted` | `add_to_blacklist` | `config`, `address`, `reason`, `blacklisted_by` |
| `AddressUnblacklisted` | `remove_from_blacklist` | `config`, `address`, `removed_by` |
| `TokensSeized` | `seize` | `config`, `from`, `to`, `amount`, `seized_by` |

### Full Event Definitions

```rust
#[event]
pub struct AddressBlacklisted {
    pub config: Pubkey,          // StablecoinConfig PDA
    pub address: Pubkey,         // The blacklisted address
    pub reason: String,          // Reason string (max 64 bytes)
    pub blacklisted_by: Pubkey,  // The Blacklister authority
}

#[event]
pub struct AddressUnblacklisted {
    pub config: Pubkey,       // StablecoinConfig PDA
    pub address: Pubkey,      // The address removed from blacklist
    pub removed_by: Pubkey,   // The Blacklister authority
}

#[event]
pub struct TokensSeized {
    pub config: Pubkey,      // StablecoinConfig PDA
    pub from: Pubkey,        // Source token account
    pub to: Pubkey,          // Destination token account
    pub amount: u64,         // Amount seized (base units)
    pub seized_by: Pubkey,   // The Seizer authority
}
```

### SSS-1 Events (also present in SSS-2)

| Event | Instruction | Key Fields |
|---|---|---|
| `StablecoinInitialized` | `initialize` | `config`, `mint`, `authority`, `name`, `symbol`, `decimals`, `enable_permanent_delegate`, `enable_transfer_hook` |
| `TokensMinted` | `mint_tokens` | `config`, `minter`, `recipient`, `amount`, `minter_total_minted` |
| `TokensBurned` | `burn_tokens` | `config`, `burner`, `from`, `amount` |
| `AccountFrozen` | `freeze_token_account` | `config`, `authority`, `account` |
| `AccountThawed` | `thaw_token_account` | `config`, `authority`, `account` |
| `StablecoinPaused` | `pause` | `config`, `authority` |
| `StablecoinUnpaused` | `unpause` | `config`, `authority` |
| `RoleUpdated` | `update_roles` | `config`, `user`, `role_type`, `active`, `updated_by` |
| `MinterQuotaUpdated` | `update_minter` | `config`, `minter`, `new_quota`, `updated_by` |
| `AuthorityTransferred` | `transfer_authority` | `config`, `previous_authority`, `new_authority` |

---

## 10. Error Codes

### SSS Program (`sss`)

Error codes are Anchor custom errors starting at offset 6000 (Anchor's base for custom errors).

| Variant | Anchor Code | Message | When Returned |
|---|---|---|---|
| `Unauthorized` | 6000 | Unauthorized - caller lacks the required role | `role_account.active == false` |
| `Paused` | 6001 | Stablecoin is paused | Mint/burn while paused |
| `NotPaused` | 6002 | Stablecoin is not paused | Unpause while not paused |
| `QuotaExceeded` | 6003 | Minter quota exceeded | Mint exceeds minter's remaining quota |
| `ZeroAmount` | 6004 | Amount must be greater than zero | `amount == 0` in mint/burn/seize |
| `NameTooLong` | 6005 | Name exceeds maximum length | `name.len() > 32` |
| `SymbolTooLong` | 6006 | Symbol exceeds maximum length | `symbol.len() > 10` |
| `UriTooLong` | 6007 | URI exceeds maximum length | `uri.len() > 200` |
| `ReasonTooLong` | 6008 | Reason exceeds maximum length | `reason.len() > 64` in blacklist operations |
| `InvalidRole` | 6009 | Invalid role type | `role_type > 4` in `update_roles` |
| `ComplianceNotEnabled` | 6010 | Compliance features not enabled on this stablecoin (SSS-1 config) | `enable_transfer_hook == false` when calling SSS-2 blacklist instructions |
| `PermanentDelegateNotEnabled` | 6011 | Permanent delegate not enabled on this stablecoin | `enable_permanent_delegate == false` when calling `seize` |
| `AlreadyBlacklisted` | 6012 | Address is already blacklisted | (Not raised directly — Anchor's `init` prevents double-create) |
| `NotBlacklisted` | 6013 | Address is not blacklisted | (Not raised directly — Anchor's PDA constraint fails) |
| `MathOverflow` | 6014 | Arithmetic overflow | Checked arithmetic failure in quota/supply tracking |
| `InvalidAuthority` | 6015 | Invalid authority - not the master authority | Non-master-authority calls `transfer_authority` |
| `SameAuthority` | 6016 | Cannot transfer authority to the same address | `new_authority == master_authority` |
| `InvalidDecimals` | 6017 | Invalid decimals - must be between 0 and 9 | `decimals > 9` |

### Transfer Hook Program (`transfer_hook`)

| Variant | Anchor Code | Message | When Returned |
|---|---|---|---|
| `SourceBlacklisted` | 6000 | Source address is blacklisted | Source token account owner has a BlacklistEntry PDA |
| `DestinationBlacklisted` | 6001 | Destination address is blacklisted | Destination token account owner has a BlacklistEntry PDA |
| `InvalidExtraAccountMetas` | 6002 | Invalid extra account metas | Malformed ExtraAccountMetaList PDA (not returned in normal operation) |

---

## 11. Role System Extensions

SSS-2 adds two roles to the five-role system. All roles are managed by the master authority via the `update_roles` instruction and stored as `RoleAccount` PDAs.

### Full Role Table

| Role | Type (`u8`) | Instruction | Preset |
|---|---|---|---|
| Minter | 0 | `mint_tokens` | SSS-1 + SSS-2 |
| Burner | 1 | `burn_tokens` | SSS-1 + SSS-2 |
| Pauser | 2 | `freeze_token_account`, `thaw_token_account`, `pause`, `unpause` | SSS-1 + SSS-2 |
| Blacklister | 3 | `add_to_blacklist`, `remove_from_blacklist` | SSS-2 only |
| Seizer | 4 | `seize` | SSS-2 only |

### Blacklister Role (type 3)

The Blacklister role authorizes an address to add and remove addresses from the on-chain blacklist. This role should typically be held by:

- A compliance operations team key (hot key with 24/7 monitoring for OFAC updates).
- Optionally, a multisig for oversight.

A single address can hold the Blacklister role for multiple stablecoin configs. Each config has independent role accounts.

`RoleAccount` PDA derivation for Blacklister:

```
Seeds: ["role", config_pubkey, [3u8], blacklister_pubkey]
Program: sss
```

### Seizer Role (type 4)

The Seizer role authorizes an address to execute seizures via the permanent delegate. This role should be granted with care — a Seizer can move tokens from any account, including those of uninvolved parties.

Recommended governance patterns:

- Multisig (e.g., 3-of-5) as the Seizer, requiring consensus before any seizure.
- Time-locked multisig for additional oversight on high-value seizures.
- Separate from the Blacklister role to enforce operational independence (blacklisting can be done by a compliance team; seizure requires legal/leadership approval).

`RoleAccount` PDA derivation for Seizer:

```
Seeds: ["role", config_pubkey, [4u8], seizer_pubkey]
Program: sss
```

### Role Lifecycle

Roles are never deleted — the `RoleAccount` PDA persists even after deactivation. Revoking a role sets `role_account.active = false`. Reactivating sets it back to `true`. This preserves the PDA (and rent) across role rotations and avoids the cost of closing and recreating PDAs.

---

## 12. Security Properties

### Invariants

1. **Blacklist cannot be bypassed by ordinary users.** Any `transfer_checked` on an SSS-2 mint routes through the transfer hook program. The hook is specified in the Token-2022 mint extension and cannot be removed after initialization. There is no mechanism for a user to call Token-2022 `transfer_checked` without triggering the hook.

2. **Seizure is exclusively through the SSS program.** The permanent delegate is the `StablecoinConfig` PDA. Since this PDA has no private key, only the `sss` program's `seize` instruction — which requires an active Seizer role — can invoke `invoke_signed` with the config's seeds. No other code path can seize tokens.

3. **Feature flags are immutable.** `enable_transfer_hook` and `enable_permanent_delegate` are set during `initialize` and have no setter instruction. A config initialized as SSS-1 cannot be upgraded to SSS-2. A config initialized as SSS-2 cannot have its hook removed.

4. **Blacklist checks are atomic with transfers.** The hook runs within the same transaction as the transfer. There is no window between a blacklisting and the enforcement taking effect for the *current* transaction. (Future transactions after a blacklisting is confirmed are immediately blocked.)

5. **Blacklister cannot seize.** The roles are independent. Holding the Blacklister role (type 3) does not grant authority to call `seize`. The Seizer role (type 4) is required separately.

6. **Seizer bypass is mint-scoped.** The seizure bypass in the hook re-derives the config PDA from the mint address and the SSS program ID. A config PDA for mint A cannot bypass the hook for mint B — each derivation is unique.

7. **All privileged operations are role-gated.** There is no "admin backdoor" instruction. The master authority can only assign/revoke roles, not directly seize, blacklist, mint, or burn.

8. **Checked arithmetic throughout.** All cumulative fields (`total_minted`, `total_burned`, `minted` in `MinterQuota`) use `checked_add`/`checked_sub`. Overflow returns `MathOverflow` rather than wrapping.

### Threat Model Considerations

- **Compromised Blacklister**: An attacker with the Blacklister key can add arbitrary addresses to the blacklist (censoring transfers) or remove entries (lifting restrictions). Mitigation: use a multisig for the Blacklister role or implement off-chain monitoring.
- **Compromised Seizer**: An attacker with the Seizer key can seize tokens from any account. Mitigation: require a multisig with a time lock for the Seizer role.
- **Compromised Master Authority**: Can revoke legitimate roles and assign the Blacklister/Seizer roles to attacker-controlled keys. Mitigation: use a multisig or hardware wallet for the master authority.
- **Hook Program Upgrade**: If the hook program is upgradeable (BPF upgradeable loader), the program authority could deploy a modified hook that bypasses blacklist checks. Mitigation: freeze the hook program's upgrade authority or use a multisig upgrade governance.

---

## 13. Regulatory Alignment

### OFAC SDN List

The Blacklister role is designed to be operated by a compliance team that monitors OFAC's SDN list updates. When a wallet address is found to belong to a sanctioned entity:

1. The Blacklister calls `add_to_blacklist` with `reason = "OFAC SDN match"` (or a more specific reference like a case number).
2. The `AddressBlacklisted` event is emitted immediately in the same transaction.
3. From the next block onwards, any `transfer_checked` involving that address is rejected by the hook with `SourceBlacklisted` or `DestinationBlacklisted`.

If a false positive is identified (address removed from the SDN list):

1. The Blacklister calls `remove_from_blacklist`.
2. The `AddressUnblacklisted` event is emitted.
3. The address is immediately unblocked.

### AML and Court-Ordered Seizure

When a legal authority orders an asset freeze and recovery:

1. **Freeze (optional)**: The Pauser can call `freeze_token_account` to prevent the account from participating in transfers through normal SPL channels. Note: the permanent delegate bypass in the hook means seizure does not require the account to be frozen first.
2. **Seizure**: The Seizer calls `seize` with the source account and a treasury destination. The `TokensSeized` event provides an on-chain record of the recovery.

The `TokensSeized` event fields (`from`, `to`, `amount`, `seized_by`) provide the audit trail required by court documentation.

### Audit Trail Format

Compliance events can be retrieved from the blockchain and indexed for regulatory reporting. The SSS backend API (`/api/audit-log`) queries transaction history for Anchor events from the SSS program and returns them in a structured format.

A complete compliance audit log for an SSS-2 stablecoin includes:

- All `AddressBlacklisted` events: who was blacklisted, when, by whom, and the stated reason.
- All `AddressUnblacklisted` events: who was cleared and by whom.
- All `TokensSeized` events: source account, destination account, amount, and operator.
- All `RoleUpdated` events with `role_type == 3` (Blacklister) or `role_type == 4` (Seizer): tracking who had compliance authority and when it changed.

### Role Separation

SSS-2 enforces separation of duties at the protocol level:

- The master authority cannot directly blacklist or seize — only assign the roles.
- The Blacklister cannot seize — only manage the blacklist.
- The Seizer cannot blacklist — only seize.
- The Pauser cannot blacklist or seize — only freeze/thaw/pause.

This separation limits blast radius if any single role is compromised and satisfies the four-eyes principle for high-risk operations when each role is held by a different operator.

---

## 14. Initialization Guide

### Step 1: Deploy Programs

Both `sss` and `transfer_hook` programs must be deployed. The `transfer_hook` program ID must be known before initializing the stablecoin.

### Step 2: Initialize the SSS Program

Call `sss::initialize` with SSS-2 parameters:

```typescript
import { SolanaStablecoin, Presets } from "@stbr/sss-core-sdk";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const TRANSFER_HOOK_PROGRAM_ID = new PublicKey("Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH");

const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    preset: Presets.SSS_2,         // enablePermanentDelegate: true, enableTransferHook: true
    name: "Compliant USD",
    symbol: "cUSD",
    uri: "https://example.com/metadata.json",
    decimals: 6,
    authority: walletKeypair.publicKey,
    transferHookProgramId: TRANSFER_HOOK_PROGRAM_ID,
  }
);

// Send the initialize transaction
const tx = new Transaction().add(instruction);
tx.feePayer = walletKeypair.publicKey;
await sendAndConfirmTransaction(connection, tx, [walletKeypair, mintKeypair]);
```

At this point:
- The Token-2022 mint exists with `PermanentDelegate`, `TransferHook`, and `MetadataPointer` extensions.
- The `StablecoinConfig` PDA is created.
- `enable_permanent_delegate = true`, `enable_transfer_hook = true`.
- The hook program is set in the `TransferHook` extension but the `ExtraAccountMetaList` PDA has not been created yet. Transfers will fail until Step 3 is complete.

### Step 3: Initialize ExtraAccountMetas

Call `transfer_hook::initialize_extra_account_metas` once for this mint:

```typescript
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import transferHookIdl from "./transfer_hook.json";

const hookProgram = new Program(transferHookIdl, provider);

const [extraAccountMetas] = PublicKey.findProgramAddressSync(
  [Buffer.from("extra-account-metas"), mintKeypair.publicKey.toBuffer()],
  TRANSFER_HOOK_PROGRAM_ID
);

await hookProgram.methods
  .initializeExtraAccountMetas()
  .accountsStrict({
    payer: walletKeypair.publicKey,
    extraAccountMetas,
    mint: mintKeypair.publicKey,
    sssProgram: SSS_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .signers([walletKeypair])
  .rpc();
```

After this step, the stablecoin is fully operational. All subsequent `transfer_checked` calls will be routed through the hook.

### Step 4: Assign Compliance Roles

```typescript
// Assign Blacklister role (role type 3)
const blacklistIx = await stablecoin.updateRoles({
  authority: walletKeypair.publicKey,
  user: blacklisterKeypair.publicKey,
  roleType: 3,
  active: true,
});

// Assign Seizer role (role type 4)
const seizerIx = await stablecoin.updateRoles({
  authority: walletKeypair.publicKey,
  user: seizerKeypair.publicKey,
  roleType: 4,
  active: true,
});

const tx = new Transaction().add(blacklistIx, seizerIx);
await sendAndConfirmTransaction(connection, tx, [walletKeypair]);
```

### Step 5: Assign Minter and Set Quota

```typescript
// Assign Minter role
const minterRoleIx = await stablecoin.updateRoles({
  authority: walletKeypair.publicKey,
  user: minterKeypair.publicKey,
  roleType: 0,
  active: true,
});

// Set minting quota (1,000,000 tokens with 6 decimals = 1,000,000,000,000 base units)
const quotaIx = await stablecoin.updateMinter({
  authority: walletKeypair.publicKey,
  minter: minterKeypair.publicKey,
  quota: new BN("1000000000000"),
});

await sendAndConfirmTransaction(connection, new Transaction().add(minterRoleIx, quotaIx), [walletKeypair]);
```

---

## 15. SDK Usage

### Package Installation

```bash
npm install @stbr/sss-core-sdk @stbr/sss-compliance-sdk
```

### Checking Compliance Feature Status

```typescript
import { SolanaStablecoin } from "@stbr/sss-core-sdk";

const stablecoin = await SolanaStablecoin.load(connection, mintAddress);
const config = await stablecoin.getConfig();

console.log("Transfer hook enabled:", config.enableTransferHook);
console.log("Permanent delegate enabled:", config.enablePermanentDelegate);
```

### Blacklist Management

```typescript
// Check if an address is blacklisted
const isBlocked = await stablecoin.compliance.isBlacklisted(suspectAddress);

// Add to blacklist (fluent API)
await stablecoin.compliance
  .blacklistAdd(suspectAddress, "OFAC SDN match — case #2024-001")
  .by(blacklisterKeypair)
  .send(payerKeypair);

// Add to blacklist (params API)
const ix = await stablecoin.compliance.blacklistAdd({
  address: suspectAddress,
  reason: "OFAC SDN match — case #2024-001",
  authority: blacklisterKeypair.publicKey,
});

// Remove from blacklist
await stablecoin.compliance
  .blacklistRemove(suspectAddress)
  .by(blacklisterKeypair)
  .send(payerKeypair);

// Fetch all blacklisted addresses
const allBlacklisted = await stablecoin.compliance.getBlacklist();
for (const entry of allBlacklisted) {
  console.log(`${entry.address.toBase58()} — ${entry.reason} — ${entry.blacklistedAt}`);
}

// Fetch a specific entry
const entry = await stablecoin.compliance.getBlacklistEntry(suspectAddress);
if (entry) {
  console.log("Blacklisted by:", entry.blacklistedBy.toBase58());
  console.log("At:", new Date(entry.blacklistedAt.toNumber() * 1000).toISOString());
}
```

### Batch Blacklisting

```typescript
// Add multiple addresses in one transaction
await stablecoin.compliance
  .batchBlacklistAdd([
    { address: alice, reason: "OFAC SDN" },
    { address: bob, reason: "Suspicious activity" },
    { address: carol, reason: "Court order #2025-47" },
  ])
  .by(blacklisterKeypair)
  .send(payerKeypair);

// Remove multiple addresses in one transaction
await stablecoin.compliance
  .batchBlacklistRemove([alice, bob])
  .by(blacklisterKeypair)
  .send(payerKeypair);
```

### Seizure

```typescript
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const fromTokenAccount = getAssociatedTokenAddressSync(
  mintAddress,
  suspectWallet,
  false,
  TOKEN_2022_PROGRAM_ID
);
const toTokenAccount = getAssociatedTokenAddressSync(
  mintAddress,
  treasuryWallet,
  false,
  TOKEN_2022_PROGRAM_ID
);

// Seize using fluent API (from/to wallet shorthand)
await stablecoin.compliance
  .seize(suspectWallet, treasuryWallet)
  .amount(new BN("5000000"))    // 5 tokens with 6 decimals
  .by(seizerKeypair)
  .send(payerKeypair);

// Seize using params API
const ix = await stablecoin.compliance.seize({
  authority: seizerKeypair.publicKey,
  fromTokenAccount,
  toTokenAccount,
  amount: new BN("5000000"),
});
```

### Compliance Module (from @stbr/sss-compliance-sdk)

```typescript
import { ComplianceModule } from "@stbr/sss-compliance-sdk";

const compliance = new ComplianceModule(
  program,
  connection,
  mintAddress,
  configAddress
);

// Summary
const summary = await compliance.getSummary();
console.log(`Blacklisted: ${summary.blacklistedCount}`);
console.log(`Total minted: ${summary.totalMinted}`);

// Check features
const hookEnabled = await compliance.isComplianceEnabled();
const seizeEnabled = await compliance.isSeizeEnabled();

// Enumerate blacklisted addresses
const entries = await compliance.blacklist.getAll();
```

### Subscribing to Compliance Events

```typescript
import { SSSEventParser } from "@stbr/sss-core-sdk";

const parser = new SSSEventParser(program);

connection.onLogs(SSS_PROGRAM_ID, ({ logs, err }) => {
  if (err) return;
  const events = parser.parseLogsForEvents(logs);
  for (const event of events) {
    if (event.name === "AddressBlacklisted") {
      console.log("ALERT: address blacklisted:", event.data.address.toBase58());
    }
    if (event.name === "TokensSeized") {
      console.log("Seizure:", event.data.amount.toString(), "from", event.data.from.toBase58());
    }
  }
});
```

---

## 16. Migration from SSS-1

**SSS-2 is not a migration target for existing SSS-1 stablecoins.** The `StablecoinConfig` feature flags (`enable_permanent_delegate`, `enable_transfer_hook`) are set during `initialize` and there is no setter instruction. The Token-2022 extensions (`PermanentDelegate`, `TransferHook`) are embedded in the mint account at creation time and cannot be added to an existing mint.

To move from SSS-1 to SSS-2 compliance:

1. **Deploy a new SSS-2 stablecoin** with the required flags and a new mint keypair.
2. **Migrate liquidity**: Coordinate with holders, DEX liquidity pools, and custody providers to move tokens to the new mint.
3. **Burn old supply**: Use `burn_tokens` on the SSS-1 stablecoin to reduce and eventually eliminate circulating supply.
4. **Update integrations**: Update all downstream applications, wallets, and API references to the new mint address.

This is intentional. Immutable feature flags mean that the compliance properties of a stablecoin are established at inception and cannot be retroactively weakened. Issuers should choose their preset carefully at deployment.

---

## 17. Use Cases

### USDC/USDT-Class Regulated Stablecoins

Major regulated stablecoin issuers (e.g., Circle for USDC, Tether for USDT) must implement OFAC sanctions controls and maintain the ability to freeze and recover assets on request from regulatory authorities. SSS-2 provides the on-chain primitive layer for these obligations on Solana.

### Central Bank Digital Currencies (CBDCs)

National CBDC deployments require programmable compliance controls, including mandatory KYC/AML screening and the ability to seize assets in criminal cases. The SSS-2 blacklist and seizure mechanisms align with these requirements. The `default_account_frozen` flag (combined with SSS-2) can enforce a whitelist model: only accounts explicitly approved (thawed) by a Pauser can receive tokens.

### Institutional Stablecoins with Legal Counterparty Risk

Stablecoins used in institutional lending, repo, or settlement markets need seizure capabilities for default scenarios. SSS-2's `seize` instruction provides the legal enforcement primitive for court-ordered recovery.

### Sandbox and Testing

SSS-2 can be initialized on devnet/testnet for compliance workflow testing without modifying the SSS-1 preset. Because presets are immutable per-mint, test stablecoins do not contaminate production blacklists.

---

*This document describes the SSS-2 implementation as of the current program version. Program IDs listed are for localnet development; devnet and mainnet deployments use different IDs.*
