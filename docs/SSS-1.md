# SSS-1: Minimal Stablecoin Standard

| Field       | Value                                        |
|-------------|----------------------------------------------|
| Standard    | SSS-1                                        |
| Title       | Minimal Stablecoin Standard                  |
| Status      | Final                                        |
| Category    | Token Standard                               |
| Created     | 2025-01-01                                   |
| Program ID  | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` |
| Runtime     | Solana / Token-2022                          |
| Framework   | Anchor 0.31.1                                |

---

## Table of Contents

1. [Abstract](#1-abstract)
2. [Motivation](#2-motivation)
3. [Specification](#3-specification)
   - 3.1 [Program ID](#31-program-id)
   - 3.2 [Account Layout](#32-account-layout)
   - 3.3 [PDA Derivation](#33-pda-derivation)
   - 3.4 [Token-2022 Extensions](#34-token-2022-extensions)
4. [Instructions](#4-instructions)
   - 4.1 [initialize](#41-initialize)
   - 4.2 [mint\_tokens](#42-mint_tokens)
   - 4.3 [burn\_tokens](#43-burn_tokens)
   - 4.4 [freeze\_token\_account](#44-freeze_token_account)
   - 4.5 [thaw\_token\_account](#45-thaw_token_account)
   - 4.6 [pause](#46-pause)
   - 4.7 [unpause](#47-unpause)
   - 4.8 [update\_roles](#48-update_roles)
   - 4.9 [update\_minter](#49-update_minter)
   - 4.10 [transfer\_authority](#410-transfer_authority)
5. [Events](#5-events)
6. [Error Codes](#6-error-codes)
7. [Role System](#7-role-system)
8. [Quota System](#8-quota-system)
9. [Security Properties](#9-security-properties)
10. [Implementation Notes](#10-implementation-notes)
11. [SDK Usage](#11-sdk-usage)
12. [Use Cases](#12-use-cases)

---

## 1. Abstract

SSS-1 (Solana Stablecoin Standard, Minimal Preset) defines the minimum viable on-chain interface for a programmable stablecoin on Solana using the Token-2022 program. It provides role-based access control, per-minter supply quotas, account-level freeze/thaw, and a global pause mechanism — all governed by a single Config PDA that owns the mint authority and freeze authority. SSS-1 deliberately excludes compliance features (forced seizure, transfer-level blacklist enforcement) that are introduced in SSS-2.

---

## 2. Motivation

Issuing a stablecoin on Solana has historically required either forking an existing token program or deploying a fully custom token mint with hand-rolled authority management. Neither approach provides a standard interface that wallets, explorers, and integrators can rely on.

SSS-1 fills this gap by specifying:

- A deterministic on-chain account structure discoverable from the mint address alone.
- A minimal but complete set of administrative operations (mint, burn, freeze, pause, role management).
- Event emission on every state-changing instruction, enabling off-chain audit trail construction without custom indexers.
- Clean separation of the master authority (who assigns roles) from operational roles (who execute mints/burns/freezes), enforcing least-privilege at the protocol level.

SSS-1 targets the broad class of stablecoins that do not require regulatory compliance features: DAO-issued stable assets, ecosystem settlement tokens, wrapped assets with simple supply management, and development/testing environments. When on-chain blacklisting or forced seizure become requirements, SSS-2 extends SSS-1 with those capabilities while preserving full API compatibility.

---

## 3. Specification

### 3.1 Program ID

The canonical SSS program is deployed at:

```
DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu
```

All PDA derivations documented in this spec use this program ID as the canonical `program_id`. Forks or alternative deployments MUST use a different program ID and MUST NOT claim SSS-1 conformance.

### 3.2 Account Layout

#### `StablecoinConfig`

The central governance account for a stablecoin instance. Owns the mint authority, freeze authority, and (in SSS-2) the permanent delegate. One per token mint. Created during `initialize` and never closed.

**Seeds:** `["stablecoin", mint_pubkey]`

**Discriminator:** Anchor 8-byte account discriminator (SHA256 hash of `"account:StablecoinConfig"`, first 8 bytes).

| Field                       | Type       | Bytes | Description                                                                 |
|-----------------------------|------------|-------|-----------------------------------------------------------------------------|
| *(discriminator)*           | `[u8; 8]`  | 8     | Anchor account discriminator                                                |
| `mint`                      | `Pubkey`   | 32    | The Token-2022 mint address                                                 |
| `name`                      | `String`   | 4+32  | Human-readable name. 4-byte length prefix + up to 32 UTF-8 bytes            |
| `symbol`                    | `String`   | 4+10  | Token ticker symbol. 4-byte length prefix + up to 10 UTF-8 bytes            |
| `uri`                       | `String`   | 4+200 | Metadata URI (off-chain JSON). 4-byte prefix + up to 200 UTF-8 bytes        |
| `decimals`                  | `u8`       | 1     | Decimal places. Valid range: 0–9                                            |
| `master_authority`          | `Pubkey`   | 32    | Address that can assign/revoke roles and set minter quotas                  |
| `enable_permanent_delegate` | `bool`     | 1     | Feature flag. Always `false` in SSS-1. Immutable after init                 |
| `enable_transfer_hook`      | `bool`     | 1     | Feature flag. Always `false` in SSS-1. Immutable after init                 |
| `default_account_frozen`    | `bool`     | 1     | Whether new token accounts default to frozen state                          |
| `enable_confidential_transfer` | `bool`  | 1     | SSS-3 flag. Always `false` in SSS-1                                         |
| `paused`                    | `bool`     | 1     | Runtime state. When `true`, mint and burn are blocked                       |
| `total_minted`              | `u64`      | 8     | Lifetime cumulative tokens minted (base units, never decremented)           |
| `total_burned`              | `u64`      | 8     | Lifetime cumulative tokens burned (base units, never decremented)           |
| `transfer_hook_program`     | `Pubkey`   | 32    | Hook program ID. `Pubkey::default()` in SSS-1                              |
| `bump`                      | `u8`       | 1     | PDA bump seed, stored to avoid recomputation in CPIs                        |
| `_reserved`                 | `[u8; 63]` | 63    | Reserved for future fields. Zero-initialized                                |
| **Total**                   |            | **399** |                                                                            |

> Note: String fields are Borsh-encoded with a 4-byte little-endian length prefix. The space allocated is the maximum (e.g., 4+200 for URI) regardless of actual content length.

#### `RoleAccount`

Tracks whether a specific user holds a specific role for a stablecoin. One PDA per `(config, role_type, user)` triple. Created lazily on first `update_roles` call using `init_if_needed`. Deactivated roles retain their PDA so they can be reactivated without a new account creation (and associated rent payment).

**Seeds:** `["role", config_pubkey, role_type_u8, user_pubkey]`

| Field       | Type     | Bytes | Description                                                      |
|-------------|----------|-------|------------------------------------------------------------------|
| *(discrim)* | `[u8;8]` | 8     | Anchor discriminator                                             |
| `config`    | `Pubkey` | 32    | The StablecoinConfig this role belongs to                        |
| `user`      | `Pubkey` | 32    | The user who holds this role                                     |
| `role_type` | `u8`     | 1     | Role type identifier (see [Role System](#7-role-system))         |
| `active`    | `bool`   | 1     | Whether the role is currently in effect                          |
| `bump`      | `u8`     | 1     | PDA bump seed                                                    |
| **Total**   |          | **75** |                                                                 |

#### `MinterQuota`

Tracks per-minter supply allowances. The `quota` field is the maximum total tokens the minter may ever mint. The `minted` field is the cumulative amount already minted and is never reset — increasing the quota gives the minter additional headroom while preserving audit history.

**Seeds:** `["minter_quota", config_pubkey, minter_pubkey]`

| Field       | Type     | Bytes | Description                                              |
|-------------|----------|-------|----------------------------------------------------------|
| *(discrim)* | `[u8;8]` | 8     | Anchor discriminator                                     |
| `config`    | `Pubkey` | 32    | The StablecoinConfig this quota belongs to               |
| `minter`    | `Pubkey` | 32    | The minter address                                       |
| `quota`     | `u64`    | 8     | Maximum lifetime mint amount (base units)                |
| `minted`    | `u64`    | 8     | Cumulative amount minted to date (base units)            |
| `bump`      | `u8`     | 1     | PDA bump seed                                            |
| **Total**   |          | **89** |                                                         |

### 3.3 PDA Derivation

All PDAs are derived using `findProgramAddress` with the program ID `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu`.

| Account          | Seeds (ordered)                                           | Notes                                 |
|------------------|-----------------------------------------------------------|---------------------------------------|
| `StablecoinConfig` | `[b"stablecoin", mint.key()]`                           | Unique per mint                       |
| `RoleAccount`      | `[b"role", config.key(), role_type_u8, user.key()]`     | Unique per (config, role, user) triple |
| `MinterQuota`      | `[b"minter_quota", config.key(), minter.key()]`         | Unique per (config, minter) pair      |

The `role_type_u8` seed is a single byte: `0x00` (Minter), `0x01` (Burner), `0x02` (Pauser), `0x03` (Blacklister — SSS-2 only), or `0x04` (Seizer — SSS-2 only). The byte is passed as a single-element slice `&[role_type]`.

**TypeScript derivation:**

```typescript
import { PublicKey } from "@solana/web3.js";

const SSS_PROGRAM_ID = new PublicKey("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu");

// StablecoinConfig PDA
const [config] = PublicKey.findProgramAddressSync(
  [Buffer.from("stablecoin"), mint.toBuffer()],
  SSS_PROGRAM_ID
);

// RoleAccount PDA
const [roleAccount] = PublicKey.findProgramAddressSync(
  [Buffer.from("role"), config.toBuffer(), Buffer.from([roleType]), user.toBuffer()],
  SSS_PROGRAM_ID
);

// MinterQuota PDA
const [minterQuota] = PublicKey.findProgramAddressSync(
  [Buffer.from("minter_quota"), config.toBuffer(), minter.toBuffer()],
  SSS_PROGRAM_ID
);
```

### 3.4 Token-2022 Extensions

SSS-1 initializes a Token-2022 mint with the following extensions:

| Extension              | Purpose                                                                                         | Required in SSS-1 |
|------------------------|-------------------------------------------------------------------------------------------------|-------------------|
| `MetadataPointer`      | Points to the mint itself as the metadata account, enabling on-chain name/symbol/URI storage    | Yes               |
| `TokenMetadata`        | Stores name, symbol, and URI directly in the mint account TLV data                             | Yes (via CPI)     |

Extensions that are **not** enabled in SSS-1 (set to `false` in `InitializeParams`):

| Extension              | SSS Preset | Purpose                                        |
|------------------------|------------|------------------------------------------------|
| `PermanentDelegate`    | SSS-2      | Allows config PDA to transfer any token balance for seizure |
| `TransferHook`         | SSS-2      | Invokes hook program on every transfer for blacklist enforcement |
| `ConfidentialTransferMint` | SSS-3  | Enables ElGamal-encrypted transfer amounts     |

**Extension initialization order** is significant in Token-2022. The SSS program initializes extensions in this order before calling `initialize_mint2`:

1. `PermanentDelegate` (if enabled)
2. `TransferHook` (if enabled)
3. `ConfidentialTransferMint` (if enabled)
4. `MetadataPointer` (always)
5. `initialize_mint2` (sets mint authority and freeze authority both to config PDA)
6. `initialize_token_metadata` CPI signed by config PDA (writes name/symbol/URI)

The mint account is pre-allocated with enough lamports to cover both the base extension layout and the variable-length metadata TLV entry, calculated as:

```
total_space = extension_layout_size + metadata_fixed_overhead(92) + name.len() + symbol.len() + uri.len()
lamports = rent_exempt_minimum(total_space)
```

---

## 4. Instructions

### 4.1 `initialize`

Creates a new stablecoin: allocates the Token-2022 mint account, initializes extensions, writes on-chain metadata, and creates the `StablecoinConfig` PDA.

**Required Accounts:**

| # | Account                  | Signer | Writable | Description                                                  |
|---|--------------------------|--------|----------|--------------------------------------------------------------|
| 0 | `authority`              | Yes    | Yes      | Transaction fee payer and initial master authority            |
| 1 | `config`                 | No     | Yes      | StablecoinConfig PDA (created by this instruction)           |
| 2 | `mint`                   | Yes    | Yes      | New Token-2022 mint keypair (caller generates)               |
| 3 | `token_program`          | No     | No       | Token-2022 program (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) |
| 4 | `associated_token_program` | No   | No       | Associated Token program                                     |
| 5 | `system_program`         | No     | No       | System program                                               |
| 6 | `rent`                   | No     | No       | Rent sysvar                                                  |

**Parameters:**

| Parameter                 | Type            | Description                                                              |
|---------------------------|-----------------|--------------------------------------------------------------------------|
| `name`                    | `String`        | Human-readable token name. Max 32 bytes                                  |
| `symbol`                  | `String`        | Token ticker symbol. Max 10 bytes                                        |
| `uri`                     | `String`        | Metadata URI. Max 200 bytes                                              |
| `decimals`                | `u8`            | Decimal places. Must be in range 0–9                                     |
| `enable_permanent_delegate` | `bool`        | Must be `false` for SSS-1                                               |
| `enable_transfer_hook`    | `bool`          | Must be `false` for SSS-1                                               |
| `default_account_frozen`  | `bool`          | Whether new token accounts start frozen                                  |
| `enable_confidential_transfer` | `bool`     | Must be `false` for SSS-1                                               |
| `transfer_hook_program_id` | `Option<Pubkey>` | Must be `None` for SSS-1                                              |

**Validation Rules:**

1. `name.len() <= 32` — else `NameTooLong`
2. `symbol.len() <= 10` — else `SymbolTooLong`
3. `uri.len() <= 200` — else `UriTooLong`
4. `decimals <= 9` — else `InvalidDecimals`

**State Changes:**

- Allocates and funds a new account at `mint` pubkey owned by Token-2022 program.
- Initializes `MetadataPointer` extension with metadata authority = config PDA, metadata address = mint.
- Calls `initialize_mint2` setting mint authority = config PDA, freeze authority = config PDA.
- Writes `TokenMetadata` TLV into mint account with provided name, symbol, URI.
- Creates `StablecoinConfig` PDA with all fields populated; `paused = false`, `total_minted = 0`, `total_burned = 0`.

**Emitted Event:** `StablecoinInitialized`

**Errors:** `NameTooLong`, `SymbolTooLong`, `UriTooLong`, `InvalidDecimals`, `MathOverflow`

---

### 4.2 `mint_tokens`

Mints new tokens to a recipient's token account. Requires an active Minter role and sufficient quota.

**Required Accounts:**

| # | Account                    | Signer | Writable | Description                                            |
|---|----------------------------|--------|----------|--------------------------------------------------------|
| 0 | `minter`                   | Yes    | No       | The address executing the mint. Must hold Minter role  |
| 1 | `config`                   | No     | Yes      | StablecoinConfig PDA. Updated: `total_minted`          |
| 2 | `role_account`             | No     | No       | RoleAccount PDA for `(config, Minter=0, minter)`       |
| 3 | `minter_quota`             | No     | Yes      | MinterQuota PDA for `(config, minter)`. Updated: `minted` |
| 4 | `mint`                     | No     | Yes      | Token-2022 mint. Supply incremented by `amount`        |
| 5 | `recipient_token_account`  | No     | Yes      | Destination token account. Balance increased by `amount` |
| 6 | `token_program`            | No     | No       | Token-2022 program                                     |

**Parameters:**

| Parameter | Type  | Description                                         |
|-----------|-------|-----------------------------------------------------|
| `amount`  | `u64` | Number of tokens to mint (base units). Must be > 0  |

**Validation Rules:**

1. `amount > 0` — else `ZeroAmount`
2. `config.paused == false` — else `Paused`
3. `role_account.active == true` — else `Unauthorized` (enforced by Anchor account constraint)
4. `minter_quota.minted + amount <= minter_quota.quota` — else `QuotaExceeded`
5. `minter_quota.minted.checked_add(amount)` must not overflow — else `MathOverflow`
6. `config.total_minted.checked_add(amount)` must not overflow — else `MathOverflow`

**State Changes:**

- `minter_quota.minted` += `amount`
- `config.total_minted` += `amount`
- Token-2022 mint supply += `amount`
- `recipient_token_account.amount` += `amount`

**CPI:** `mint_to` signed by config PDA (as mint authority).

**Emitted Event:** `TokensMinted`

**Errors:** `ZeroAmount`, `Paused`, `Unauthorized`, `QuotaExceeded`, `MathOverflow`

---

### 4.3 `burn_tokens`

Burns tokens from a token account. Requires an active Burner role. The burner must be the owner or delegate of the source token account (enforced by the Token-2022 program, not the SSS program).

**Required Accounts:**

| # | Account              | Signer | Writable | Description                                            |
|---|----------------------|--------|----------|--------------------------------------------------------|
| 0 | `burner`             | Yes    | No       | The address executing the burn. Must hold Burner role  |
| 1 | `config`             | No     | Yes      | StablecoinConfig PDA. Updated: `total_burned`          |
| 2 | `role_account`       | No     | No       | RoleAccount PDA for `(config, Burner=1, burner)`       |
| 3 | `mint`               | No     | Yes      | Token-2022 mint. Supply decremented by `amount`        |
| 4 | `from_token_account` | No     | Yes      | Source token account. Must be owned or delegated to `burner` |
| 5 | `token_program`      | No     | No       | Token-2022 program                                     |

**Parameters:**

| Parameter | Type  | Description                                         |
|-----------|-------|-----------------------------------------------------|
| `amount`  | `u64` | Number of tokens to burn (base units). Must be > 0  |

**Validation Rules:**

1. `amount > 0` — else `ZeroAmount`
2. `config.paused == false` — else `Paused`
3. `role_account.active == true` — else `Unauthorized` (Anchor constraint)
4. `burner` must be the owner or delegate of `from_token_account` — enforced by Token-2022 `burn` CPI (returns `OwnerMismatch` if violated)
5. `config.total_burned.checked_add(amount)` must not overflow — else `MathOverflow`

**State Changes:**

- `config.total_burned` += `amount`
- Token-2022 mint supply -= `amount`
- `from_token_account.amount` -= `amount`

**CPI:** `burn` with `burner` as the authority signer.

**Emitted Event:** `TokensBurned`

**Errors:** `ZeroAmount`, `Paused`, `Unauthorized`, `MathOverflow`

---

### 4.4 `freeze_token_account`

Freezes a token account, preventing all transfers from that account. Requires an active Pauser role. The config PDA signs as freeze authority.

**Required Accounts:**

| # | Account        | Signer | Writable | Description                                             |
|---|----------------|--------|----------|---------------------------------------------------------|
| 0 | `authority`    | Yes    | No       | Address executing the freeze. Must hold Pauser role     |
| 1 | `config`       | No     | No       | StablecoinConfig PDA (provides freeze authority via PDA signer) |
| 2 | `role_account` | No     | No       | RoleAccount PDA for `(config, Pauser=2, authority)`     |
| 3 | `mint`         | No     | No       | Token-2022 mint (read-only; validated by `config.mint`) |
| 4 | `token_account`| No     | Yes      | Token account to freeze                                 |
| 5 | `token_program`| No     | No       | Token-2022 program                                      |

**Parameters:** None.

**Validation Rules:**

1. `config.paused == false` — else `Paused`
2. `role_account.active == true` — else `Unauthorized` (Anchor constraint)
3. `token_account.mint == config.mint` — enforced by Anchor `token::mint` constraint
4. `token_account` must not already be frozen — Token-2022 program returns an error if already frozen

**State Changes:**

- `token_account.state` set to `Frozen`

**CPI:** `freeze_account` signed by config PDA (as freeze authority).

**Emitted Event:** `AccountFrozen`

**Errors:** `Paused`, `Unauthorized`

---

### 4.5 `thaw_token_account`

Thaws a previously frozen token account, restoring its ability to send transfers. Requires an active Pauser role.

**Required Accounts:**

| # | Account        | Signer | Writable | Description                                             |
|---|----------------|--------|----------|---------------------------------------------------------|
| 0 | `authority`    | Yes    | No       | Address executing the thaw. Must hold Pauser role       |
| 1 | `config`       | No     | No       | StablecoinConfig PDA (provides freeze authority via PDA signer) |
| 2 | `role_account` | No     | No       | RoleAccount PDA for `(config, Pauser=2, authority)`     |
| 3 | `mint`         | No     | No       | Token-2022 mint (read-only)                             |
| 4 | `token_account`| No     | Yes      | Token account to thaw                                   |
| 5 | `token_program`| No     | No       | Token-2022 program                                      |

**Parameters:** None.

**Validation Rules:**

1. `role_account.active == true` — else `Unauthorized` (Anchor constraint)
2. `token_account.mint == config.mint` — Anchor constraint
3. `token_account` must currently be frozen — Token-2022 returns an error if not frozen

> Note: Unlike `freeze_token_account`, thaw does **not** check `config.paused`. This is intentional: an operator must be able to thaw accounts to restore access even while the stablecoin is globally paused (e.g., to resolve an incorrect freeze during an incident).

**State Changes:**

- `token_account.state` set to `Initialized` (active)

**CPI:** `thaw_account` signed by config PDA (as freeze authority).

**Emitted Event:** `AccountThawed`

**Errors:** `Unauthorized`

---

### 4.6 `pause`

Globally pauses the stablecoin. While paused, `mint_tokens`, `burn_tokens`, and `freeze_token_account` are blocked. Transfers and thaws remain available. Requires an active Pauser role.

**Required Accounts:**

| # | Account        | Signer | Writable | Description                                             |
|---|----------------|--------|----------|---------------------------------------------------------|
| 0 | `authority`    | Yes    | No       | Address executing the pause. Must hold Pauser role      |
| 1 | `config`       | No     | Yes      | StablecoinConfig PDA. Updated: `paused = true`          |
| 2 | `role_account` | No     | No       | RoleAccount PDA for `(config, Pauser=2, authority)`     |

**Parameters:** None.

**Validation Rules:**

1. `config.paused == false` — else `Paused` (cannot pause an already-paused stablecoin)
2. `role_account.active == true` — else `Unauthorized` (Anchor constraint)

**State Changes:**

- `config.paused` set to `true`

**Emitted Event:** `StablecoinPaused`

**Errors:** `Paused`, `Unauthorized`

---

### 4.7 `unpause`

Removes the global pause, re-enabling mint and burn operations. Requires an active Pauser role.

**Required Accounts:**

| # | Account        | Signer | Writable | Description                                             |
|---|----------------|--------|----------|---------------------------------------------------------|
| 0 | `authority`    | Yes    | No       | Address executing the unpause. Must hold Pauser role    |
| 1 | `config`       | No     | Yes      | StablecoinConfig PDA. Updated: `paused = false`         |
| 2 | `role_account` | No     | No       | RoleAccount PDA for `(config, Pauser=2, authority)`     |

**Parameters:** None.

**Validation Rules:**

1. `config.paused == true` — else `NotPaused` (cannot unpause a non-paused stablecoin)
2. `role_account.active == true` — else `Unauthorized` (Anchor constraint)

**State Changes:**

- `config.paused` set to `false`

**Emitted Event:** `StablecoinUnpaused`

**Errors:** `NotPaused`, `Unauthorized`

---

### 4.8 `update_roles`

Assigns or revokes a role for a user. Master authority only. The RoleAccount PDA is created on first call using `init_if_needed`; subsequent calls to the same `(config, role_type, user)` triple reuse the existing account and update only the `active` field.

**Required Accounts:**

| # | Account        | Signer | Writable | Description                                                          |
|---|----------------|--------|----------|----------------------------------------------------------------------|
| 0 | `authority`    | Yes    | Yes      | Must equal `config.master_authority`                                 |
| 1 | `config`       | No     | No       | StablecoinConfig PDA. Validated: `master_authority == authority`     |
| 2 | `role_account` | No     | Yes      | RoleAccount PDA. Created if not exists (`init_if_needed`)            |
| 3 | `system_program` | No   | No       | Required for `init_if_needed` account creation                       |

**Parameters:**

| Parameter   | Type     | Description                                                                    |
|-------------|----------|--------------------------------------------------------------------------------|
| `role_type` | `u8`     | Role identifier. Valid values: `0` (Minter), `1` (Burner), `2` (Pauser)       |
| `user`      | `Pubkey` | Address to assign/revoke the role for                                          |
| `active`    | `bool`   | `true` to grant the role, `false` to revoke it                                 |

**Validation Rules:**

1. `authority.key() == config.master_authority` — else `InvalidAuthority` (Anchor constraint)
2. `role_type <= 4` (ROLE_SEIZER) — else `InvalidRole`
3. If `role_type == 3` (Blacklister): `config.enable_transfer_hook == true` — else `ComplianceNotEnabled`
4. If `role_type == 4` (Seizer): `config.enable_permanent_delegate == true` — else `ComplianceNotEnabled`

> In SSS-1 configurations, rules 3 and 4 always reject Blacklister and Seizer role assignments since both feature flags are `false`. The valid SSS-1 role types are `0`, `1`, and `2`.

**State Changes:**

- `role_account.config` = config pubkey
- `role_account.user` = `user` parameter
- `role_account.role_type` = `role_type` parameter
- `role_account.active` = `active` parameter
- `role_account.bump` = canonical PDA bump

**Emitted Event:** `RoleUpdated`

**Errors:** `InvalidAuthority`, `InvalidRole`, `ComplianceNotEnabled`

---

### 4.9 `update_minter`

Sets or updates a minter's maximum mint quota. Master authority only. The MinterQuota PDA is created on first call using `init_if_needed`. Updating the quota does **not** reset the `minted` counter — the history of past minting is always preserved.

**Required Accounts:**

| # | Account        | Signer | Writable | Description                                                         |
|---|----------------|--------|----------|---------------------------------------------------------------------|
| 0 | `authority`    | Yes    | Yes      | Must equal `config.master_authority`                                |
| 1 | `config`       | No     | No       | StablecoinConfig PDA. Validated: `master_authority == authority`    |
| 2 | `minter_quota` | No     | Yes      | MinterQuota PDA. Created if not exists (`init_if_needed`)           |
| 3 | `system_program` | No   | No       | Required for `init_if_needed` account creation                      |

**Parameters:**

| Parameter | Type     | Description                                                    |
|-----------|----------|----------------------------------------------------------------|
| `minter`  | `Pubkey` | The minter address this quota applies to                       |
| `quota`   | `u64`    | The new maximum lifetime mint allowance (base units)           |

**Validation Rules:**

1. `authority.key() == config.master_authority` — else `InvalidAuthority` (Anchor constraint)

> The minter must also hold an active Minter role (type `0`) to actually call `mint_tokens`. However, `update_minter` does not verify this — a quota can be set before or after the role is assigned.

**State Changes:**

- `minter_quota.config` = config pubkey
- `minter_quota.minter` = `minter` parameter
- `minter_quota.quota` = `quota` parameter
- `minter_quota.bump` = canonical PDA bump
- `minter_quota.minted` — **NOT modified** (history preserved)

**Emitted Event:** `MinterQuotaUpdated`

**Errors:** `InvalidAuthority`

---

### 4.10 `transfer_authority`

Transfers the master authority to a new address. The transfer is immediate and irreversible within the same transaction — the previous authority loses all privileges the instant the instruction executes.

**Required Accounts:**

| # | Account     | Signer | Writable | Description                                                     |
|---|-------------|--------|----------|-----------------------------------------------------------------|
| 0 | `authority` | Yes    | No       | Current master authority. Must equal `config.master_authority`  |
| 1 | `config`    | No     | Yes      | StablecoinConfig PDA. Updated: `master_authority`               |

**Parameters:**

| Parameter       | Type     | Description                                               |
|-----------------|----------|-----------------------------------------------------------|
| `new_authority` | `Pubkey` | The incoming master authority address                     |

**Validation Rules:**

1. `authority.key() == config.master_authority` — else `InvalidAuthority` (Anchor constraint)
2. `new_authority != config.master_authority` — else `SameAuthority`

**State Changes:**

- `config.master_authority` = `new_authority`

**Emitted Event:** `AuthorityTransferred`

**Errors:** `InvalidAuthority`, `SameAuthority`

---

## 5. Events

Every state-changing SSS-1 instruction emits exactly one Anchor event, which is ABI-encoded in the transaction log as a base64-encoded byte sequence. Clients can parse events using the Anchor event parser or the `@stbr/sss-core-sdk` event listener.

| Event                  | Instruction              | Fields                                                                                               |
|------------------------|--------------------------|------------------------------------------------------------------------------------------------------|
| `StablecoinInitialized`| `initialize`             | `config: Pubkey`, `mint: Pubkey`, `authority: Pubkey`, `name: String`, `symbol: String`, `decimals: u8`, `enable_permanent_delegate: bool`, `enable_transfer_hook: bool`, `enable_confidential_transfer: bool` |
| `TokensMinted`         | `mint_tokens`            | `config: Pubkey`, `minter: Pubkey`, `recipient: Pubkey`, `amount: u64`, `minter_total_minted: u64`  |
| `TokensBurned`         | `burn_tokens`            | `config: Pubkey`, `burner: Pubkey`, `from: Pubkey`, `amount: u64`                                   |
| `AccountFrozen`        | `freeze_token_account`   | `config: Pubkey`, `authority: Pubkey`, `account: Pubkey`                                            |
| `AccountThawed`        | `thaw_token_account`     | `config: Pubkey`, `authority: Pubkey`, `account: Pubkey`                                            |
| `StablecoinPaused`     | `pause`                  | `config: Pubkey`, `authority: Pubkey`                                                               |
| `StablecoinUnpaused`   | `unpause`                | `config: Pubkey`, `authority: Pubkey`                                                               |
| `RoleUpdated`          | `update_roles`           | `config: Pubkey`, `user: Pubkey`, `role_type: u8`, `active: bool`, `updated_by: Pubkey`            |
| `MinterQuotaUpdated`   | `update_minter`          | `config: Pubkey`, `minter: Pubkey`, `new_quota: u64`, `updated_by: Pubkey`                         |
| `AuthorityTransferred` | `transfer_authority`     | `config: Pubkey`, `previous_authority: Pubkey`, `new_authority: Pubkey`                             |

### Event Discriminators

Anchor events use a discriminator derived from the first 8 bytes of `SHA256("event:<EventName>")`. Clients parsing raw transaction logs should filter program log entries starting with `"Program data: "` and decode the base64 payload.

---

## 6. Error Codes

Anchor error codes begin at 6000. The SSS program's custom errors start immediately after the framework base.

| Code   | Name                      | Message                                                       | Relevant Instructions                   |
|--------|---------------------------|---------------------------------------------------------------|-----------------------------------------|
| 6000   | `Unauthorized`            | Unauthorized - caller lacks the required role                 | `mint_tokens`, `burn_tokens`, `freeze_token_account`, `thaw_token_account`, `pause`, `unpause` |
| 6001   | `Paused`                  | Stablecoin is paused                                          | `mint_tokens`, `burn_tokens`, `freeze_token_account`, `pause` |
| 6002   | `NotPaused`               | Stablecoin is not paused                                      | `unpause`                               |
| 6003   | `QuotaExceeded`           | Minter quota exceeded                                         | `mint_tokens`                           |
| 6004   | `ZeroAmount`              | Amount must be greater than zero                              | `mint_tokens`, `burn_tokens`            |
| 6005   | `NameTooLong`             | Name exceeds maximum length                                   | `initialize`                            |
| 6006   | `SymbolTooLong`           | Symbol exceeds maximum length                                 | `initialize`                            |
| 6007   | `UriTooLong`              | URI exceeds maximum length                                    | `initialize`                            |
| 6008   | `ReasonTooLong`           | Reason exceeds maximum length                                 | SSS-2 only                              |
| 6009   | `InvalidRole`             | Invalid role type                                             | `update_roles`                          |
| 6010   | `ComplianceNotEnabled`    | Compliance features not enabled on this stablecoin (SSS-1 config) | `update_roles` (Blacklister/Seizer)  |
| 6011   | `PermanentDelegateNotEnabled` | Permanent delegate not enabled on this stablecoin         | SSS-2 only                              |
| 6012   | `AlreadyBlacklisted`      | Address is already blacklisted                                | SSS-2 only                              |
| 6013   | `NotBlacklisted`          | Address is not blacklisted                                    | SSS-2 only                              |
| 6014   | `MathOverflow`            | Arithmetic overflow                                           | `initialize`, `mint_tokens`, `burn_tokens` |
| 6015   | `InvalidAuthority`        | Invalid authority - not the master authority                  | `update_roles`, `update_minter`, `transfer_authority` |
| 6016   | `SameAuthority`           | Cannot transfer authority to the same address                 | `transfer_authority`                    |
| 6017   | `InvalidDecimals`         | Invalid decimals - must be between 0 and 9                    | `initialize`                            |

---

## 7. Role System

SSS-1 implements role-based access control (RBAC) via `RoleAccount` PDAs. Each role is a separate on-chain account, making role status queryable without fetching the config account.

### Role Types

| ID | Name          | Constant          | Permitted Operations                                              |
|----|---------------|-------------------|-------------------------------------------------------------------|
| 0  | Minter        | `ROLE_MINTER`     | `mint_tokens` (subject to quota)                                  |
| 1  | Burner        | `ROLE_BURNER`     | `burn_tokens`                                                     |
| 2  | Pauser        | `ROLE_PAUSER`     | `freeze_token_account`, `thaw_token_account`, `pause`, `unpause`  |
| 3  | Blacklister   | `ROLE_BLACKLISTER`| SSS-2 only: `add_to_blacklist`, `remove_from_blacklist`           |
| 4  | Seizer        | `ROLE_SEIZER`     | SSS-2 only: `seize`                                               |

SSS-1 configurations expose only roles 0, 1, and 2. Assigning role 3 or 4 on an SSS-1 config returns `ComplianceNotEnabled`.

### Role Assignment

Only the `master_authority` recorded in the `StablecoinConfig` can call `update_roles`. There is no secondary admin or role delegation. The master authority can:

- **Grant** a role: call `update_roles(role_type, user, active=true)`
- **Revoke** a role: call `update_roles(role_type, user, active=false)`

A single user can hold multiple roles simultaneously (e.g., both Minter and Pauser). Each role is a separate PDA, so each requires a separate `update_roles` call.

### Role PDA Lifecycle

The `RoleAccount` PDA is created by `update_roles` using `init_if_needed`:

- **First assignment:** Anchor creates the PDA, pays rent from `authority`.
- **Subsequent updates:** Anchor finds the existing PDA and updates only `active`.
- **Revocation:** Sets `active = false`. The PDA is **not** closed — rent is retained. Reactivation is a single transaction (no new rent required).

### Role Verification Pattern

Instructions that require a role verify it through an Anchor account constraint on the `role_account` field:

```rust
#[account(
    seeds = [ROLE_SEED, config.key().as_ref(), &[ROLE_MINTER], minter.key().as_ref()],
    bump = role_account.bump,
    constraint = role_account.active @ StablecoinError::Unauthorized,
)]
pub role_account: Account<'info, RoleAccount>,
```

This means:
1. The PDA address must match the deterministic derivation (wrong minter → wrong PDA → account not found).
2. The `active` field must be `true` (revoked role → `Unauthorized`).

Passing a spoofed account at a different address would fail PDA seed verification. There is no way to bypass role checks by submitting a crafted account.

### Separation of Duties

The master authority explicitly **cannot** mint, burn, or freeze tokens directly — it can only manage roles and quotas. This prevents a single key compromise from executing all operations. An adversary who obtains the master authority key can:

- Grant themselves operational roles in a subsequent transaction.
- Increase minter quotas.
- Transfer authority to themselves if already held.

But they cannot mint tokens without also having (or granting themselves) a Minter role and a non-zero quota.

---

## 8. Quota System

Each Minter operates under an independent quota tracked by a `MinterQuota` PDA.

### How Quotas Work

The `MinterQuota` account stores two values:

- **`quota`**: The maximum cumulative amount the minter may mint. Set by the master authority via `update_minter`.
- **`minted`**: The cumulative amount already minted by this minter. Incremented on every successful `mint_tokens` call.

The check on each mint is:

```
minted + amount <= quota
```

If this check fails, `QuotaExceeded` is returned and the transaction is rejected.

### Quota Semantics

| Property              | Behavior                                                                                 |
|-----------------------|------------------------------------------------------------------------------------------|
| **Ceiling, not rate** | The quota is a lifetime ceiling, not a per-period rate. No automatic replenishment.      |
| **Non-resettable**    | `minted` is never reset by the protocol. The master authority cannot reset it.           |
| **Adjustable**        | The master authority can increase or decrease `quota` at any time. Decreasing the quota below the current `minted` value effectively blocks future minting for this minter. |
| **Independent**       | Each minter's quota is independent. Global `total_minted` on the config is the sum of all minter contributions, but individual quotas do not share a pool. |
| **Zero quota**        | A `MinterQuota` with `quota = 0` prevents all minting. Setting `quota = 0` is equivalent to disabling the minter without revoking the role. |

### Quota Setup

A minter requires **both** an active Minter role (`RoleAccount` with `active = true`) **and** a `MinterQuota` with sufficient headroom to mint:

```
remaining_quota = minter_quota.quota - minter_quota.minted
```

The minimum setup for a new minter:

1. Master authority calls `update_minter(minter_pubkey, quota_amount)` — creates `MinterQuota`
2. Master authority calls `update_roles(0, minter_pubkey, true)` — creates active `RoleAccount`

These two calls can be in the same transaction or separate transactions.

### Audit Trail

Because `minted` is never reset, the `MinterQuota` account provides a tamper-proof lifetime audit trail of how much a given minter has produced. Increasing the quota does not erase previous mint history. This property ensures that off-chain reconciliation of on-chain minting history is always possible.

---

## 9. Security Properties

The following invariants are maintained by the SSS-1 protocol:

### Supply Invariants

1. **Monotonic counters**: `config.total_minted` and `config.total_burned` are monotonically non-decreasing. No instruction ever decrements them.
2. **Minter counter monotonicity**: `minter_quota.minted` is monotonically non-decreasing. It is incremented on every successful mint and never decremented.
3. **Quota ceiling**: At all times, `minter_quota.minted <= minter_quota.quota` is guaranteed to hold after any successful `mint_tokens` call. The check uses checked arithmetic so overflow cannot bypass it.
4. **No unchecked arithmetic**: All additions use `checked_add`. Overflow returns `MathOverflow` and the transaction is rejected, leaving all state unchanged.

### Authority Invariants

5. **Config PDA owns mint authority**: The mint authority is set to the config PDA at initialization and is never reassigned on-chain. No instruction provides a mechanism to change the mint authority away from the config PDA.
6. **Config PDA owns freeze authority**: The freeze authority is set to the config PDA at initialization and is never reassigned. Only holders of the Pauser role (via the config PDA CPI signing) can freeze or thaw accounts.
7. **Master authority is a single key**: There is no multi-sig or threshold scheme built into SSS-1. If multi-sig governance is required, the `master_authority` should be set to a program-derived address of a governance program (e.g., SPL Governance).
8. **Authority transfer is atomic**: The `transfer_authority` instruction updates `master_authority` within a single instruction. There is no two-step transfer (propose/accept) at the SSS-1 level. Callers requiring safe handoff should use a higher-level governance mechanism.

### Pause Invariants

9. **Pause blocks mint and burn**: When `config.paused == true`, both `mint_tokens` and `burn_tokens` return `Paused` before any state mutation occurs.
10. **Pause does not block transfers**: The SSS-1 program does not intercept or block token transfers directly. SPL transfers on the token account proceed regardless of `config.paused`. (SSS-2 uses a transfer hook to enforce additional transfer-level controls.)
11. **Pause idempotency protection**: Calling `pause` on an already-paused config returns `Paused`. Calling `unpause` on a non-paused config returns `NotPaused`. This prevents silent no-ops from confusing operators.

### Freeze Invariants

12. **Freeze requires non-paused state**: `freeze_token_account` requires `config.paused == false`. This prevents issuing new freezes during a global pause incident.
13. **Thaw is always available**: `thaw_token_account` has no pause check. A Pauser can thaw an account even during a global pause.

---

## 10. Implementation Notes

### Anchor Version

The SSS program uses **Anchor 0.31.1** (CLI 0.32.1). The Anchor `#[program]` macro generates instruction discriminators and account deserialization. Clients must use a compatible Anchor version or parse raw instruction data manually.

### Token-2022 Program Address

The Token-2022 program is at `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`. All mints created by SSS are owned by this program. Classic SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) is not supported.

### CPI Signing Pattern

The config PDA signs CPIs (mint, freeze, thaw) using standard Anchor PDA signer seeds:

```rust
let signer_seeds: &[&[&[u8]]] = &[&[
    b"stablecoin",
    mint_key.as_ref(),
    &[config.bump],
]];
```

The bump is stored in `config.bump` to avoid an on-chain `find_program_address` call on every CPI, keeping compute units predictable.

### `init_if_needed` Pattern

`update_roles` and `update_minter` use Anchor's `init_if_needed` constraint on `role_account` and `minter_quota` respectively. This means:

- The payer (`authority`) may be charged rent for account creation on the first call.
- On subsequent calls to the same PDA, no new account is created and no rent is charged.
- The `authority` must be writable to allow System Program account creation.

### Dependency Pins

The following crate versions are pinned due to Solana BPF toolchain compatibility:

```toml
blake3 = "=1.5.5"
constant_time_eq = "=0.3.1"
```

These pins apply transitively to any workspace member that directly or indirectly depends on these crates.

### Account Size Calculation

`StablecoinConfig::LEN` is a compile-time constant at 399 bytes. This is pre-allocated in full during `initialize`, meaning the account is never reallocated after creation. The `_reserved` field (63 bytes) provides headroom for future fields without requiring a migration instruction.

### Metadata TLV Realloc

The Token-2022 metadata is stored as a TLV (type-length-value) extension entry in the mint account. The mint account is initially allocated at extension layout size but pre-funded with enough lamports to cover the post-metadata-write size. The `initialize_token_metadata` CPI will realloc the account internally. The pre-funding calculation is:

```
metadata_space = 92 (fixed overhead) + name.len() + symbol.len() + uri.len()
total = base_extension_size + metadata_space
lamports = rent_exempt_minimum(total)
```

---

## 11. SDK Usage

The `@stbr/sss-core-sdk` package provides a TypeScript SDK for all SSS-1 operations.

### Installation

```bash
npm install @stbr/sss-core-sdk @solana/web3.js @coral-xyz/anchor @solana/spl-token
```

### Creating an SSS-1 Stablecoin

```typescript
import { Connection, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { SolanaStablecoin } from "@stbr/sss-core-sdk";

const connection = new Connection("https://api.mainnet-beta.solana.com");
const authority = Keypair.generate(); // your wallet keypair

// Create instruction + mint keypair
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(connection, {
  name: "My Stablecoin",
  symbol: "MUSD",
  uri: "https://example.com/metadata.json",
  decimals: 6,
  // SSS-1: all compliance features disabled
  enablePermanentDelegate: false,
  enableTransferHook: false,
  defaultAccountFrozen: false,
  authority: authority.publicKey,
});

// Both authority (fee payer) and mintKeypair must sign
const tx = new Transaction().add(instruction);
await sendAndConfirmTransaction(connection, tx, [authority, mintKeypair]);

console.log("Mint:", stablecoin.mintAddress.toBase58());
console.log("Config:", stablecoin.configAddress.toBase58());
```

### Loading an Existing Stablecoin

```typescript
import { PublicKey } from "@solana/web3.js";
import { SolanaStablecoin } from "@stbr/sss-core-sdk";

const stablecoin = await SolanaStablecoin.load(connection, new PublicKey("MintAddressHere..."));
const config = await stablecoin.getConfig();
console.log("Paused:", config.paused);
console.log("Total minted:", config.totalMinted.toString());
```

### Assigning Roles and Setting Quotas

```typescript
import { RoleType } from "@stbr/sss-core-sdk";

const minterKeypair = Keypair.generate();
const QUOTA = 1_000_000_000_000n; // 1,000,000 tokens with 6 decimals

// Assign Minter role (fluent API)
const roleIx = await stablecoin.updateRoles({
  roleType: RoleType.Minter,   // 0
  user: minterKeypair.publicKey,
  active: true,
  authority: authority.publicKey,
});

// Set quota for the minter
const quotaIx = await stablecoin.updateMinter({
  minter: minterKeypair.publicKey,
  quota: QUOTA,
  authority: authority.publicKey,
});

const tx = new Transaction().add(roleIx, quotaIx);
await sendAndConfirmTransaction(connection, tx, [authority]);
```

### Minting Tokens

```typescript
import { getAssociatedTokenAddressSync, createAssociatedTokenAccountInstruction } from "@solana/spl-token";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

const recipient = Keypair.generate();
const recipientATA = getAssociatedTokenAddressSync(
  stablecoin.mintAddress,
  recipient.publicKey,
  false,
  TOKEN_2022_PROGRAM_ID
);

// Create ATA if needed
const createATAIx = createAssociatedTokenAccountInstruction(
  authority.publicKey,
  recipientATA,
  recipient.publicKey,
  stablecoin.mintAddress,
  TOKEN_2022_PROGRAM_ID
);

// Build mint instruction (fluent API)
const mintIx = await stablecoin.mint({
  amount: 100_000_000n,  // 100 MUSD (6 decimals)
  recipientTokenAccount: recipientATA,
  minter: minterKeypair.publicKey,
});

const tx = new Transaction().add(createATAIx, mintIx);
await sendAndConfirmTransaction(connection, tx, [authority, minterKeypair]);
```

### Burning Tokens

```typescript
// Assign Burner role first
const burnerRoleIx = await stablecoin.updateRoles({
  roleType: RoleType.Burner,   // 1
  user: burnerKeypair.publicKey,
  active: true,
  authority: authority.publicKey,
});

// Burn tokens
const burnIx = await stablecoin.burn({
  amount: 50_000_000n,  // 50 MUSD
  fromTokenAccount: sourceATA,
  burner: burnerKeypair.publicKey,
});

const tx = new Transaction().add(burnIx);
await sendAndConfirmTransaction(connection, tx, [burnerKeypair]);
```

### Freezing and Thawing Accounts

```typescript
// Assign Pauser role
const pauserRoleIx = await stablecoin.updateRoles({
  roleType: RoleType.Pauser,   // 2
  user: pauserKeypair.publicKey,
  active: true,
  authority: authority.publicKey,
});

// Freeze a token account
const freezeIx = await stablecoin.freeze({
  tokenAccount: targetATA,
  authority: pauserKeypair.publicKey,
});

// Thaw a previously frozen account
const thawIx = await stablecoin.thaw({
  tokenAccount: targetATA,
  authority: pauserKeypair.publicKey,
});

const freezeTx = new Transaction().add(freezeIx);
await sendAndConfirmTransaction(connection, freezeTx, [pauserKeypair]);
```

### Pausing and Unpausing

```typescript
// Pause all minting and burning
const pauseIx = await stablecoin.pause({
  authority: pauserKeypair.publicKey,
});

// Unpause
const unpauseIx = await stablecoin.unpause({
  authority: pauserKeypair.publicKey,
});
```

### Querying State

```typescript
// Fetch stablecoin configuration
const config = await stablecoin.getConfig();
console.log("Name:", config.name);
console.log("Symbol:", config.symbol);
console.log("Decimals:", config.decimals);
console.log("Paused:", config.paused);
console.log("Master authority:", config.masterAuthority.toBase58());

// Fetch current circulating supply
const supply = await stablecoin.getSupply();
console.log("Supply:", supply.uiAmount, config.symbol);

// Check a minter's quota
const quota = await stablecoin.getMinterQuota(minterKeypair.publicKey);
if (quota) {
  const remaining = quota.quota - quota.minted;
  console.log("Quota:", quota.quota.toString());
  console.log("Minted:", quota.minted.toString());
  console.log("Remaining:", remaining.toString());
}

// Check a role
const role = await stablecoin.getRole(RoleType.Minter, minterKeypair.publicKey);
console.log("Minter active:", role?.active);
```

### Transferring Authority

```typescript
const newAuthority = Keypair.generate();

const transferIx = await stablecoin.transferAuthority({
  newAuthority: newAuthority.publicKey,
  authority: authority.publicKey,
});

const tx = new Transaction().add(transferIx);
await sendAndConfirmTransaction(connection, tx, [authority]);
// authority no longer has master authority after this point
```

### PDA Derivation Helpers

```typescript
import { getConfigAddress, getRoleAddress, getMinterQuotaAddress } from "@stbr/sss-core-sdk";

const SSS_PROGRAM_ID = new PublicKey("DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu");

const [config, configBump] = getConfigAddress(SSS_PROGRAM_ID, mintAddress);
const [role] = getRoleAddress(SSS_PROGRAM_ID, config, RoleType.Minter, minterAddress);
const [quota] = getMinterQuotaAddress(SSS_PROGRAM_ID, config, minterAddress);
```

---

## 12. Use Cases

### When to Use SSS-1

SSS-1 is appropriate when:

- **No forced seizure is required.** Token balances can only be reduced voluntarily (the holder initiates burn) or via accounts the burner already controls. If a regulator could require you to forcibly claw back tokens from a specific wallet, use SSS-2.

- **No transfer-level blocking is required.** SSS-1 does not intercept transfers. A holder can send tokens to any address at any time (unless their token account is individually frozen). If you need to block all transfers involving a specific wallet address at the network level, use SSS-2.

- **Supply management is needed without compliance infrastructure.** You need to control who can mint and how much (quotas), control who can burn, and have an emergency pause mechanism.

- **DAO treasury or ecosystem token.** A DAO wants to issue a stable denomination token with governance-controlled minting (e.g., via a governance PDA as master authority).

- **Wrapped asset issuance.** A bridge operator issues a wrapped stablecoin where the bridging program is the minter. Quota enforcement ensures the on-chain supply cannot exceed the locked collateral.

- **Development or staging environment.** You want to prototype with a production-equivalent token standard before deploying SSS-2 for mainnet.

### When to Use SSS-2 Instead

Prefer SSS-2 over SSS-1 when any of the following apply:

- **Regulatory compliance is required.** OFAC sanctions compliance, AML/KYC requirements, or any jurisdiction that mandates the ability to block sanctioned addresses from transacting.
- **Forced seizure must be possible.** Court orders, law enforcement requests, or smart contract exploit recovery that requires moving tokens from a wallet without the holder's consent.
- **Transfer-level blacklist enforcement.** The requirement is not just "freeze this account" but "reject all transfers involving this address, even as a recipient."
- **You are issuing a USDC/USDT-class regulated stablecoin.** These issuers maintain on-chain blacklists and seizure mechanisms by regulatory requirement.

### Upgradeability

SSS-1 and SSS-2 use the same on-chain program. The distinction is purely in the feature flags set at initialization (`enable_permanent_delegate`, `enable_transfer_hook`). These flags are immutable after creation — an SSS-1 stablecoin **cannot** be upgraded to SSS-2 in place. If compliance features are later required, a new mint must be issued and existing balances migrated (typically via a coordinated swap or redemption).
