# Constants Reference

This document enumerates every program constant used across the Solana Stablecoin Standard — PDA seeds, program IDs, role identifiers, field length limits, and numeric bounds. Use this as the single source of truth when deriving accounts off-chain or validating instruction parameters.

---

## PDA Seeds

Every on-chain account in SSS is a Program Derived Address (PDA). The seeds below are the canonical byte-string prefixes used in `find_program_address` calls. All seeds are UTF-8 encoded byte slices. Pubkeys are passed as their 32-byte raw form (not base58).

### Core SSS Program

#### StablecoinConfig

```
Seeds: ["stablecoin", mint_pubkey]
Program: SSS (DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu)
```

The central configuration account for a stablecoin instance. There is exactly one `StablecoinConfig` per mint. It owns the mint authority, freeze authority, and (when SSS-2) the permanent delegate authority.

TypeScript derivation:
```typescript
const [configPda, bump] = PublicKey.findProgramAddressSync(
  [Buffer.from("stablecoin"), mint.toBuffer()],
  SSS_PROGRAM_ID
);
```

Rust derivation:
```rust
let seeds = &[b"stablecoin", mint.as_ref()];
let (config_pda, bump) = Pubkey::find_program_address(seeds, &crate::ID);
```

#### RoleAccount

```
Seeds: ["role", config_pubkey, role_type_u8, user_pubkey]
Program: SSS
```

One PDA per (stablecoin config, role type, user) triple. The `role_type_u8` is passed as a single-byte slice (`[role_type]`). Roles are stored as independent PDAs — not arrays — so the set of role holders scales without bound and individual revocations are O(1).

TypeScript derivation:
```typescript
const [rolePda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("role"),
    configPda.toBuffer(),
    Buffer.from([roleType]),  // 0-4, single byte
    userPubkey.toBuffer(),
  ],
  SSS_PROGRAM_ID
);
```

#### MinterQuota

```
Seeds: ["minter_quota", config_pubkey, minter_pubkey]
Program: SSS
```

Tracks a minter's cumulative `minted` counter against their authorized `quota`. Created when the master authority calls `update_minter` for the first time.

TypeScript derivation:
```typescript
const [quotaPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("minter_quota"), configPda.toBuffer(), minter.toBuffer()],
  SSS_PROGRAM_ID
);
```

#### BlacklistEntry

```
Seeds: ["blacklist", config_pubkey, address_pubkey]
Program: SSS
```

Existence of this PDA signals that `address_pubkey` is on the blacklist for this stablecoin. The transfer hook program reads this PDA during every `transfer_checked`. Closing the PDA (via `remove_from_blacklist`) immediately lifts the restriction.

TypeScript derivation:
```typescript
const [blacklistPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("blacklist"), configPda.toBuffer(), address.toBuffer()],
  SSS_PROGRAM_ID
);
```

### Transfer Hook Program

#### ExtraAccountMetas

```
Seeds: ["extra-account-metas", mint_pubkey]
Program: Transfer Hook (Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH)
```

Stores the list of additional accounts that Token-2022 must resolve and pass to the transfer hook on every `transfer_checked`. The SSS implementation stores the SSS program ID and the two dynamic blacklist PDAs (source owner and destination owner) encoded as `Seed::AccountData` references.

TypeScript derivation:
```typescript
const [extraMetasPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("extra-account-metas"), mint.toBuffer()],
  TRANSFER_HOOK_PROGRAM_ID
);
```

### Oracle Program

#### OracleConfig

```
Seeds: ["oracle_config", stablecoin_config_pubkey]
Program: Oracle (6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ)
```

Stores the Switchboard V2 aggregator address, price bounds, staleness threshold, and the latest verified price. One oracle config per stablecoin. Linked to the stablecoin config by seed.

```typescript
const [oraclePda] = PublicKey.findProgramAddressSync(
  [Buffer.from("oracle_config"), configPda.toBuffer()],
  ORACLE_PROGRAM_ID
);
```

### Privacy Program (SSS-3)

#### PrivacyConfig

```
Seeds: ["privacy_config", stablecoin_config_pubkey]
Program: Privacy (Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk)
```

Root configuration for the confidential-transfer allowlist. Stores the authority and the `auto_approve` flag.

```typescript
const [privacyConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("privacy_config"), configPda.toBuffer()],
  PRIVACY_PROGRAM_ID
);
```

#### AllowlistEntry (Privacy)

```
Seeds: ["allowlist", privacy_config_pubkey, address_pubkey]
Program: Privacy
```

Presence of this PDA indicates that `address_pubkey` is approved to use confidential transfers on this stablecoin.

```typescript
const [allowlistPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("allowlist"), privacyConfigPda.toBuffer(), address.toBuffer()],
  PRIVACY_PROGRAM_ID
);
```

---

## Program IDs

### Localnet (Surfpool)

| Program | ID |
|---------|-----|
| SSS (core) | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` |
| Transfer Hook | `Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH` |
| Oracle | `6PHWYPgkVWE7f5Saak4EXVh49rv9ZcXdz7HMfHnQdNLJ` |
| Privacy | `Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk` |
| SSS-Math | _(library, no deployment)_ |

### Devnet

Devnet program IDs are generated fresh on each deployment run. After deploying, record the IDs produced by `anchor deploy` and store them in your `.sss-token.json` config or environment variables. The core four programs maintain keypair identity across re-deployments when using `--program-keypair`.

### Mainnet

Mainnet program IDs must be announced publicly before launch. Use the same keypair-based deployment to maintain stable addresses. See `docs/DEPLOYMENT.md` for the full upgrade process.

### System Programs (always fixed)

| Program | ID |
|---------|-----|
| Token-2022 | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |
| SPL Token | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA` |
| System Program | `11111111111111111111111111111111` |
| Associated Token | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bB5` |
| Rent Sysvar | `SysvarRent111111111111111111111111111111111` |
| Clock Sysvar | `SysvarC1ock11111111111111111111111111111111` |

---

## Role Type Identifiers

Roles are stored as a single `u8` in the PDA seeds and in the `RoleAccount.role_type` field.

| Role | Value | Description | Feature Requirement |
|------|-------|-------------|---------------------|
| Minter | `0` | Can call `mint_tokens` up to their assigned quota | All presets |
| Burner | `1` | Can call `burn_tokens` on accounts they control | All presets |
| Pauser | `2` | Can call `pause`, `unpause`, `freeze_token_account`, `thaw_token_account` | All presets |
| Blacklister | `3` | Can call `add_to_blacklist` and `remove_from_blacklist` | `enable_transfer_hook = true` |
| Seizer | `4` | Can call `seize` to force-transfer tokens | `enable_permanent_delegate = true` |

Rust constants from `programs/sss/src/constants.rs`:

```rust
pub const ROLE_MINTER: u8     = 0;
pub const ROLE_BURNER: u8     = 1;
pub const ROLE_PAUSER: u8     = 2;
pub const ROLE_BLACKLISTER: u8 = 3;
pub const ROLE_SEIZER: u8     = 4;
```

Multiple users can hold the same role simultaneously. A user can hold multiple different roles. The master authority does not need any role — it can always assign/revoke roles and transfer authority.

---

## Field Length Limits

All string fields are Rust `String` values stored on-chain. The limits below are enforced by the program before writing to the account. Violations return the corresponding error code (see `docs/ERRORS.md`).

| Constant | Value | Field | Error on Violation |
|----------|-------|-------|-------------------|
| `MAX_NAME_LEN` | 32 bytes | `StablecoinConfig.name` | `NameTooLong` |
| `MAX_SYMBOL_LEN` | 10 bytes | `StablecoinConfig.symbol` | `SymbolTooLong` |
| `MAX_URI_LEN` | 200 bytes | `StablecoinConfig.uri` | `UriTooLong` |
| `MAX_REASON_LEN` | 64 bytes | `BlacklistEntry.reason` | `ReasonTooLong` |

These limits determine the allocation size of the PDA accounts. The account sizes are calculated once at initialization and cannot be expanded without closing and re-creating the account.

### Account Size Formulas

```
StablecoinConfig.LEN =
  8 (discriminator)
  + 32 (mint)
  + (4 + 32) (name: string prefix + MAX_NAME_LEN)
  + (4 + 10) (symbol)
  + (4 + 200) (uri)
  + 1 (decimals)
  + 32 (master_authority)
  + 1 + 1 + 1 + 1 (feature flags x4)
  + 1 (paused)
  + 8 + 8 (total_minted, total_burned)
  + 32 (transfer_hook_program)
  + 8 (supply_cap)
  + 32 (pending_authority)
  + 8 (authority_transfer_at)
  + 1 (bump)
  + 15 (_reserved)

RoleAccount.LEN = 8 + 32 + 32 + 1 + 1 + 1 = 75 bytes

MinterQuota.LEN = 8 + 32 + 32 + 8 + 8 + 1 = 89 bytes

BlacklistEntry.LEN =
  8 + 32 + 32 + (4 + 64) + 8 + 32 + 1 = 181 bytes
```

---

## Numeric Limits

| Limit | Value | Description |
|-------|-------|-------------|
| Max supply cap | `u64::MAX` (18,446,744,073,709,551,615) | Upper bound for `supply_cap` and `quota` fields |
| Supply cap disabled | `0` | Setting `supply_cap = 0` means unlimited |
| Max BPS | `10_000` | Basis points denominator (100.00%) |
| Max decimals | `9` | Token decimals; values 0–9 are valid, ≥10 returns `InvalidDecimals` |
| Minter quota disabled | `u64::MAX` | Effectively unlimited quota |

---

## Transfer Hook Discriminator

The SPL Transfer Hook Interface uses a non-Anchor discriminator for the execute instruction. SSS implements a `fallback` handler to route calls with this discriminator to the blacklist enforcement logic.

```
Discriminator: [105, 37, 101, 197, 75, 251, 102, 26]
```

In Rust (used in the `fallback` function):
```rust
const TRANSFER_HOOK_EXECUTE_DISCRIMINATOR: [u8; 8] =
    [105, 37, 101, 197, 75, 251, 102, 26];
```

This discriminator is the SHA256 hash prefix of the string `"spl-transfer-hook-interface:execute"`, matching the SPL Transfer Hook interface specification. When Token-2022 CPIs into the transfer hook program during `transfer_checked`, it uses this discriminator — not the standard Anchor 8-byte prefix — so a `fallback` handler is required to intercept it.

---

## Oracle Constants

The Oracle program uses the following bounds for price validation. These are not Rust constants but are configurable per `OracleConfig` instance.

| Field | Default | Description |
|-------|---------|-------------|
| `staleness_threshold` | configurable (seconds) | Max age of Switchboard price data before rejecting |
| `min_price` | configurable | Minimum acceptable price (in price-decimals units) |
| `max_price` | configurable | Maximum acceptable price |
| `price_decimals` | configurable | Number of decimal places in the stored price |

For a USD-pegged stablecoin, typical values are:
- `staleness_threshold`: 60 seconds
- `min_price`: 0.98 × 10^6 (USD price with 6 decimals)
- `max_price`: 1.02 × 10^6

---

## Anchor Framework Constants

| Constant | Value | Description |
|----------|-------|-------------|
| Anchor discriminator size | 8 bytes | First 8 bytes of every account are the type discriminator |
| Max transaction size | 1,232 bytes | Solana v1 transaction limit |
| Max accounts per tx | 64 | Including program IDs and signers |
| Rent epoch | `u64::MAX` | Accounts are rent-exempt when initialized with `init` |
