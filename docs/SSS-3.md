# SSS-3: Privacy Stablecoin Standard

> Experimental proof-of-concept -- Token-2022 confidential transfer tooling is still maturing.

## Overview

SSS-3 is the third preset in the Solana Stablecoin Standard. It extends the base SSS-1 capabilities with Token-2022's **ConfidentialTransferMint** extension, enabling privacy-preserving token transfers where amounts are encrypted using ElGamal encryption and validated via zero-knowledge range proofs.

A companion **Privacy Program** manages a scoped allowlist that controls which addresses are permitted to use confidential transfer mode. This creates a KYC/AML boundary: only addresses explicitly added to the allowlist by a designated authority can configure their accounts for confidential operations.

### Design Principles

- **Additive privacy**: SSS-3 adds _only_ confidential transfer capability to the SSS-1 base. Compliance features (blacklist, seize, transfer hook) from SSS-2 remain available via custom configuration but are not part of the default SSS-3 preset.
- **Scoped access**: The on-chain allowlist prevents anonymous adoption of confidential mode, preserving regulatory compatibility.
- **Auditor support**: The ConfidentialTransferMint extension supports an optional auditor ElGamal public key, enabling a designated compliance entity to decrypt transfer amounts without exposing them publicly.
- **Proof-of-concept scope**: SSS-3 documents the architecture, on-chain account layout, and SDK surface area. Client-side ZK proof generation depends on `@solana/spl-token` experimental APIs that are still evolving.

---

## Architecture

```
                     SSS Program                    Privacy Program
                    (SSS-3 preset)                   (Allowlist)
                         |                               |
      ┌──────────────────┤                    ┌──────────┤
      |                  |                    |          |
      v                  v                    v          v
 Token-2022 Mint    StablecoinConfig     PrivacyConfig   AllowlistEntry
 (extensions:        PDA                   PDA             PDAs
  MetadataPointer                         (linked to       (per-address
  + Confidential                           config)          approval)
    TransferMint)
      |
      v
 Token Accounts
 (ConfidentialTransferAccount
  extension per account)
      |
      v
 Encrypted Balances
 (ElGamal ciphertexts,
  ZK range proofs)
```

### Program Relationships

| Program | Role | Program ID |
|---------|------|------------|
| SSS Program | Creates Token-2022 mint with ConfidentialTransferMint extension; manages roles, quotas, pause, freeze | `DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu` |
| Privacy Program | Manages the scoped allowlist controlling access to confidential transfers | `Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk` |
| Token-2022 | Handles all confidential transfer cryptographic operations (encryption, proofs, balance tracking) | `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` |

---

## How Confidential Transfers Work

Token-2022's confidential transfer extension uses **twisted ElGamal encryption** for amount hiding and **Bulletproof-style zero-knowledge range proofs** to ensure encrypted amounts are valid (non-negative, no overflow) without revealing the actual values.

### Lifecycle

```
 1. Initialize Mint          2. Configure Account       3. Approve Account
    (authority sets up           (user provides              (authority or
     CT extension on              ElGamal pubkey)             auto-approve)
     Token-2022 mint)

       |                           |                          |
       v                           v                          v

 4. Deposit                  5. Apply Pending            6. Transfer
    (public balance ->           (pending ->                 (confidential ->
     pending confidential)        available                   confidential,
                                  confidential)               ZK proofs attached)

       |                                                      |
       v                                                      v

 7. Withdraw                                            Recipient receives
    (confidential ->                                    encrypted amount in
     public balance)                                    pending balance
```

#### Step-by-Step Detail

1. **Mint Initialization**: The SSS `initialize` instruction creates the Token-2022 mint with the `ConfidentialTransferMint` extension. This extension stores the confidential transfer authority (the config PDA), the auto-approve flag, and an optional auditor ElGamal public key.

2. **Account Configuration**: Each user who wants to use confidential transfers must configure their token account with an ElGamal public key and a decryptable zero-balance proof. This is done client-side via `confidential_transfer::instruction::configure_account`.

3. **Account Approval**: If `auto_approve_new_accounts` is `true` (the SSS-3 PoC default), accounts are approved automatically. Otherwise, the confidential transfer authority must explicitly approve each account via `confidential_transfer::instruction::approve_account`.

4. **Deposit**: Users move tokens from their public (visible) balance into their pending confidential balance. The amount is encrypted under the user's ElGamal public key.

5. **Apply Pending Balance**: Users apply their pending confidential balance to their available confidential balance. This two-step process prevents front-running: a sender cannot observe when a recipient's balance changes during a transfer.

6. **Confidential Transfer**: Users transfer tokens from their available confidential balance to another account's pending confidential balance. The transaction includes:
   - Encrypted source amount (new balance ciphertext)
   - Encrypted destination amount (transfer ciphertext)
   - Zero-knowledge range proof (proves amount >= 0 and source balance >= transfer amount)
   - Optional auditor ciphertext (encrypted under auditor's ElGamal key)

7. **Withdraw**: Users move tokens from their confidential balance back to their public balance, making them visible on-chain again.

### What Is Encrypted vs. Public

| Data | Visibility |
|------|-----------|
| Transfer amounts (confidential mode) | Encrypted (ElGamal ciphertext) |
| Account balances (confidential mode) | Encrypted (ElGamal ciphertext) |
| Public balances | Visible on-chain |
| Pending balance counts | Visible (number of pending transfers, not amounts) |
| Account ElGamal public keys | Visible on-chain |
| Account approval status | Visible on-chain |
| Mint/burn operations | Always public (use public balance) |
| Token account ownership | Always public |

---

## Privacy Program (Allowlist)

The Privacy Program is a companion Anchor program that manages a scoped allowlist controlling which addresses may configure their token accounts for confidential transfers.

### Program ID

```
Bmyova5VaKqiBRRDV4ft8pLsdfgMMZojafLy4sdFDWQk
```

### PDA Seeds

| Account | Seeds | Description |
|---------|-------|-------------|
| PrivacyConfig | `["privacy_config", stablecoin_config]` | Per-stablecoin privacy configuration |
| AllowlistEntry | `["allowlist", privacy_config, address]` | Per-address approval record |

### Account Structures

#### PrivacyConfig

```rust
#[account]
pub struct PrivacyConfig {
    /// The SSS StablecoinConfig PDA this privacy config is linked to.
    pub stablecoin_config: Pubkey,        // 32 bytes
    /// Authority who can manage the allowlist and update config.
    pub authority: Pubkey,                 // 32 bytes
    /// Whether new accounts are auto-approved for confidential transfers.
    /// When true, the allowlist serves as an audit log rather than a gate.
    pub auto_approve: bool,                // 1 byte
    /// Whether the allowlist is actively enforced.
    /// When false, any address can configure confidential transfers.
    pub enforce_allowlist: bool,           // 1 byte
    /// Optional auditor ElGamal public key for compliance visibility.
    /// If set, all confidential transfers include an auditor ciphertext
    /// that this key can decrypt.
    pub auditor_pubkey: Option<[u8; 32]>,  // 1 + 32 bytes
    /// Total number of addresses on the allowlist.
    pub allowlist_count: u64,              // 8 bytes
    /// PDA bump seed.
    pub bump: u8,                          // 1 byte
    /// Reserved for future use.
    pub _reserved: [u8; 64],              // 64 bytes
}
```

#### AllowlistEntry

```rust
#[account]
pub struct AllowlistEntry {
    /// The PrivacyConfig this entry belongs to.
    pub privacy_config: Pubkey,   // 32 bytes
    /// The address that is allowed to use confidential transfers.
    pub address: Pubkey,          // 32 bytes
    /// Human-readable label (e.g., "KYC verified", "institutional").
    pub label: String,            // 4 + up to 64 bytes
    /// Unix timestamp when the address was added.
    pub added_at: i64,            // 8 bytes
    /// Authority who added the address.
    pub added_by: Pubkey,         // 32 bytes
    /// PDA bump seed.
    pub bump: u8,                 // 1 byte
}
```

### Instructions

#### `initialize_privacy`

Creates the `PrivacyConfig` PDA for a stablecoin instance.

| Parameter | Type | Description |
|-----------|------|-------------|
| `auto_approve` | `bool` | Whether to auto-approve new confidential accounts |
| `enforce_allowlist` | `bool` | Whether the allowlist is actively enforced |
| `auditor_pubkey` | `Option<[u8; 32]>` | Optional auditor ElGamal public key |

**Authorization**: Must be signed by the stablecoin's `master_authority`.

**Accounts**:
- `authority` (signer, mut) -- the stablecoin master authority
- `privacy_config` (init, PDA) -- the new PrivacyConfig account
- `stablecoin_config` -- the SSS StablecoinConfig (verified: `enable_confidential_transfer == true`)
- `system_program`

#### `update_privacy_config`

Updates the privacy configuration (auto-approve flag, enforcement mode, auditor key).

| Parameter | Type | Description |
|-----------|------|-------------|
| `new_auto_approve` | `Option<bool>` | Updated auto-approve setting |
| `new_enforce_allowlist` | `Option<bool>` | Updated enforcement setting |
| `new_auditor_pubkey` | `Option<Option<[u8; 32]>>` | Updated auditor key (nested Option to allow clearing) |

**Authorization**: Must be signed by the `privacy_config.authority`.

#### `add_to_allowlist`

Creates an `AllowlistEntry` PDA for an address, permitting it to configure confidential transfers.

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `Pubkey` | The address to add |
| `label` | `String` | Human-readable label (max 64 chars) |

**Authorization**: Must be signed by the `privacy_config.authority`.

**Events**: Emits `AddressAllowlisted { privacy_config, address, label, added_by }`.

#### `remove_from_allowlist`

Closes the `AllowlistEntry` PDA, revoking the address's permission to configure confidential transfers. Rent is returned to the authority.

| Parameter | Type | Description |
|-----------|------|-------------|
| `address` | `Pubkey` | The address to remove |

**Authorization**: Must be signed by the `privacy_config.authority`.

**Events**: Emits `AddressRemovedFromAllowlist { privacy_config, address, removed_by }`.

### Allowlist Enforcement Flow

```
User wants to configure confidential transfers
    |
    v
Check: Does PrivacyConfig.enforce_allowlist == true?
    |
    ├── No  --> User can configure freely
    |
    └── Yes --> Check: Does AllowlistEntry PDA exist for this user?
                    |
                    ├── Yes --> User can configure confidential transfers
                    |
                    └── No  --> Configuration rejected
```

Note: The allowlist check happens at the application layer (SDK/backend) before submitting the `configure_account` instruction. On-chain, Token-2022 enforces the `auto_approve` flag at the mint level. For production deployments, `auto_approve` should be set to `false` so that the privacy program authority must explicitly approve each account after verifying allowlist membership.

---

## SSS-3 Preset Configuration

### On-Chain Feature Flags

```rust
StablecoinConfig {
    enable_permanent_delegate: false,
    enable_transfer_hook: false,
    default_account_frozen: false,
    enable_confidential_transfer: true,  // SSS-3 differentiator
    // ... other fields
}
```

### SDK Preset

```typescript
/**
 * SSS-3 preset: Privacy stablecoin.
 *
 * - Confidential transfers enabled (ElGamal encryption + ZK proofs)
 * - No permanent delegate (no seize)
 * - No transfer hook (no blacklist enforcement on transfers)
 * - Token accounts are not frozen by default
 *
 * Use this preset for privacy-preserving stablecoins where transfer
 * amounts should be hidden from public view. Combine with the
 * PrivacyModule for allowlist management.
 */
export const SSS_3: PresetConfig = {
  permanentDelegate: false,
  transferHook: false,
  defaultAccountFrozen: false,
  confidentialTransfer: true,
};
```

### Design Rationale

SSS-3 is intentionally minimal. It adds _only_ the confidential transfer extension to the base SSS-1 preset:

- **No permanent delegate**: Seizing encrypted balances introduces complex cryptographic challenges (the authority cannot know the exact balance without the user's ElGamal secret key or auditor key). This is deferred to future research.
- **No transfer hook**: Blacklist enforcement on confidential transfers is an open problem. The transfer hook would need to validate encrypted amounts, which the current hook architecture does not support.
- **No default frozen accounts**: Confidential transfer configuration requires accounts to be in a usable state.

For deployments that need both privacy and compliance, a custom configuration combining SSS-2 and SSS-3 flags is possible but requires careful consideration of the interaction between encrypted balances, seizure, and blacklist enforcement.

---

## Token-2022 Extensions (SSS-3)

| Extension | Purpose | When Enabled |
|-----------|---------|--------------|
| MetadataPointer | Points mint metadata to the mint itself | Always |
| ConfidentialTransferMint | Enables encrypted balances and ZK-proven transfers | SSS-3 |

### ConfidentialTransferMint Extension Data

When the SSS `initialize` instruction creates the mint with `enable_confidential_transfer: true`, the following extension data is written:

| Field | Value | Description |
|-------|-------|-------------|
| `authority` | Config PDA | Can approve/revoke confidential accounts |
| `auto_approve_new_accounts` | `true` (PoC default) | New accounts auto-approved for confidential mode |
| `auditor_elgamal_pubkey` | `None` (PoC default) | No auditor configured by default |

The authority and auditor can be updated post-initialization via Token-2022's `confidential_transfer::instruction::update_mint` instruction, signed by the config PDA.

---

## SDK Usage

### Creating an SSS-3 Stablecoin

```typescript
import { SolanaStablecoin } from "@stbr/sss-core-sdk";

// Initialize with SSS-3 preset (confidential transfers enabled)
const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(connection, {
  name: "Private USD",
  symbol: "pUSD",
  uri: "https://example.com/pusd-metadata.json",
  decimals: 6,
  enablePermanentDelegate: false,
  enableTransferHook: false,
  defaultAccountFrozen: false,
  enableConfidentialTransfer: true,
  authority: wallet.publicKey,
});
```

### Initializing the Privacy Allowlist

```typescript
import { PrivacyModule } from "@stbr/sss-core-sdk";

// Load the privacy module for an existing SSS-3 stablecoin
const privacy = await PrivacyModule.load(connection, stablecoin.configAddress);

// Initialize privacy config (one-time setup)
const initIx = await privacy.initialize(wallet.publicKey, {
  autoApprove: true,
  enforceAllowlist: true,
  auditorPubkey: null,  // No auditor for PoC
});

// Add addresses to the allowlist
const addIx = await privacy.addToAllowlist(wallet.publicKey, recipientAddress, {
  label: "KYC verified",
});

// Remove from allowlist
const removeIx = await privacy.removeFromAllowlist(wallet.publicKey, recipientAddress);

// Query allowlist status
const entry = await privacy.getAllowlistEntry(recipientAddress);
if (entry) {
  console.log(`Approved: ${entry.address.toBase58()} (${entry.label})`);
  console.log(`Added at: ${new Date(entry.addedAt * 1000).toISOString()}`);
}
```

### Confidential Transfer Lifecycle (Client-Side)

```typescript
import {
  createApproveAccountInstruction,
  createConfigureAccountInstruction,
  createDepositInstruction,
  createApplyPendingBalanceInstruction,
  createTransferInstruction,
  createWithdrawInstruction,
} from "@solana/spl-token";

// 1. Generate ElGamal keypair for the user
//    (experimental -- key management is non-trivial)
const elGamalKeypair = ElGamalKeypair.new();

// 2. Configure the token account for confidential transfers
const configureIx = createConfigureAccountInstruction(
  tokenAccount,
  mint,
  elGamalKeypair.publicKey,
  decryptableZeroBalance,  // proof of zero balance under ElGamal
  wallet.publicKey,
  [],                       // multisig signers
  TOKEN_2022_PROGRAM_ID,
);

// 3. Deposit public tokens into confidential balance
const depositIx = createDepositInstruction(
  tokenAccount,
  mint,
  amount,
  decimals,
  wallet.publicKey,
  [],
  TOKEN_2022_PROGRAM_ID,
);

// 4. Apply pending balance to make it available
const applyIx = createApplyPendingBalanceInstruction(
  tokenAccount,
  expectedPendingBalanceCount,
  elGamalKeypair,  // needed to decrypt pending balance
  TOKEN_2022_PROGRAM_ID,
);

// 5. Transfer confidentially (ZK proof generated client-side)
const transferIx = createTransferInstruction(
  sourceTokenAccount,
  mint,
  destinationTokenAccount,
  sourceOwner,
  amount,
  decimals,
  sourceElGamalKeypair,      // source decryption key
  sourceAvailableBalance,     // current encrypted balance
  destinationElGamalPubkey,   // recipient's public key
  auditorElGamalPubkey,       // optional auditor key
  TOKEN_2022_PROGRAM_ID,
);

// 6. Withdraw from confidential back to public balance
const withdrawIx = createWithdrawInstruction(
  tokenAccount,
  mint,
  amount,
  decimals,
  elGamalKeypair,            // needed for ZK proof
  currentEncryptedBalance,   // current confidential balance
  TOKEN_2022_PROGRAM_ID,
);
```

---

## PDA Layout Summary

Including SSS-3 accounts alongside existing SSS PDAs:

| Account | Seeds | Program |
|---------|-------|---------|
| StablecoinConfig | `["stablecoin", mint]` | SSS |
| RoleAccount | `["role", config, role_type_u8, user]` | SSS |
| MinterQuota | `["minter_quota", config, minter]` | SSS |
| BlacklistEntry | `["blacklist", config, address]` | SSS |
| ExtraAccountMetas | `["extra-account-metas", mint]` | Transfer Hook |
| OracleConfig | `["oracle_config", stablecoin_config]` | Oracle |
| PrivacyConfig | `["privacy_config", stablecoin_config]` | Privacy |
| AllowlistEntry | `["allowlist", privacy_config, address]` | Privacy |

---

## Data Flow

### Confidential Transfer Flow (SSS-3)

```
User → SDK (PrivacyModule) → Privacy Program
  1. Check AllowlistEntry PDA exists for user
  2. If allowlist enforced and not found → reject

User → SDK (Token-2022 helpers) → Token-2022
  3. configure_account (ElGamal pubkey + zero-balance proof)
  4. deposit (public → pending confidential)
  5. apply_pending_balance (pending → available)
  6. transfer (available → recipient pending, ZK proof attached)
  7. withdraw (confidential → public)
```

### Auditor Visibility Flow

```
Confidential Transfer Transaction
  → Includes auditor ciphertext (encrypted under auditor ElGamal key)
  → On-chain: amount hidden from all observers
  → Auditor: decrypts using auditor secret key → sees transfer amount
  → Everyone else: sees only encrypted ciphertext
```

---

## Security Considerations

### Cryptographic Security

- **ElGamal encryption** provides computational security under the Decisional Diffie-Hellman (DDH) assumption on Curve25519. It is not information-theoretic: a sufficiently powerful adversary could theoretically break the encryption. In practice, this is equivalent to the security of Ed25519 signatures used throughout Solana.
- **Zero-knowledge range proofs** (Bulletproof-based) guarantee that encrypted amounts are non-negative and do not overflow the `u64` range, without revealing the actual values. These proofs are verified by Token-2022 on-chain.
- **Twisted ElGamal** is a variant that allows efficient homomorphic addition of ciphertexts, enabling balance tracking without decryption.

### Privacy Boundaries

| What is private | What is public |
|----------------|----------------|
| Transfer amounts (in confidential mode) | Transfer participants (sender, recipient) |
| Account balances (in confidential mode) | Account existence and ownership |
| | Mint/burn amounts (always public) |
| | Deposit/withdraw amounts (transition points) |
| | Number of pending transfers |
| | Account ElGamal public keys |

### Access Control

- The **confidential transfer authority** (config PDA) can approve/revoke accounts for confidential mode and update the auditor key. This authority is the same PDA that controls mint and freeze operations, maintaining a unified trust model.
- The **privacy config authority** is set independently during `initialize_privacy`. It can be the same as the stablecoin master authority or a separate key, enabling delegation of allowlist management.
- **Authority rotation**: The privacy config authority can be transferred independently from the stablecoin master authority, allowing fine-grained access control.

### Allowlist as KYC/AML Boundary

The privacy allowlist serves as the compliance interface for confidential transfers:

- Only addresses explicitly added to the allowlist (with a human-readable label such as "KYC verified" or "institutional") can use confidential mode.
- Removing an address from the allowlist does not retroactively decrypt their balance or prevent them from withdrawing to public mode. It prevents further confidential account configuration.
- The allowlist is on-chain and auditable: anyone can verify which addresses are approved and when they were added.

### Auditor Integration

The optional auditor ElGamal public key provides a compliance escape hatch:

- When configured, every confidential transfer includes an additional ciphertext encrypted under the auditor's key.
- The auditor can decrypt transfer amounts for compliance reporting, AML monitoring, or law enforcement requests.
- The auditor cannot modify balances, approve accounts, or interfere with transfers. It is a read-only compliance role.
- Auditor key rotation requires a mint-level update (`confidential_transfer::instruction::update_mint` signed by the config PDA).

### Compute Budget

Confidential transfers are significantly more expensive than regular transfers due to ZK proof verification:

| Operation | Approximate CU Cost |
|-----------|-------------------|
| Regular transfer | ~50,000 CU |
| Confidential transfer (with range proof) | ~200,000 CU |
| Configure account (zero-balance proof) | ~100,000 CU |
| Deposit / Withdraw | ~80,000 CU |

Transactions involving confidential transfers should request elevated compute budgets via `ComputeBudgetProgram.setComputeUnitLimit`.

---

## Comparison: SSS-1 vs SSS-2 vs SSS-3

| Feature | SSS-1 | SSS-2 | SSS-3 |
|---------|:-----:|:-----:|:-----:|
| Mint / Burn | Yes | Yes | Yes |
| Freeze / Thaw | Yes | Yes | Yes |
| Pause / Unpause | Yes | Yes | Yes |
| Role-Based Access Control | Yes | Yes | Yes |
| Minter Quotas | Yes | Yes | Yes |
| On-Chain Metadata | Yes | Yes | Yes |
| Blacklist | -- | Yes | -- |
| Seize (Permanent Delegate) | -- | Yes | -- |
| Transfer Hook Enforcement | -- | Yes | -- |
| Confidential Transfers | -- | -- | Yes |
| Privacy Allowlist | -- | -- | Yes |
| Auditor Support | -- | -- | Yes (optional) |

### Choosing a Preset

| Use Case | Recommended Preset |
|----------|-------------------|
| Internal test tokens, community tokens | SSS-1 |
| Regulated stablecoins, sanctions compliance | SSS-2 |
| Privacy-preserving stablecoins, confidential payments | SSS-3 |
| Regulated + private (advanced) | Custom: SSS-2 + SSS-3 flags combined |

---

## Feature Gating

SSS-3 instructions and behaviors are gated by the `enable_confidential_transfer` flag in the `StablecoinConfig`:

```rust
// On-chain gate (privacy program)
require!(
    config.enable_confidential_transfer,
    PrivacyError::ConfidentialTransferNotEnabled
);
```

```typescript
// SDK gate (PrivacyModule)
const config = await stablecoin.getConfig();
if (!config.enableConfidentialTransfer) {
  throw new Error("Confidential transfers not enabled on this stablecoin");
}
```

The feature flag is immutable after initialization, consistent with SSS-1 and SSS-2 behavior. A stablecoin initialized without `enable_confidential_transfer: true` cannot later enable confidential transfers.

---

## Current Limitations (Proof-of-Concept Status)

The following limitations reflect the current state of Token-2022 confidential transfer tooling and are expected to improve as the ecosystem matures.

### 1. Client-Side ZK Proof Generation

The `@solana/spl-token` package (v0.4+) includes experimental support for confidential transfer instructions, but the client-side proof generation APIs are not yet stabilized. The proof generation requires:

- ElGamal keypair management
- Homomorphic balance computation
- Bulletproof range proof construction
- Correct nonce handling for replay protection

Production deployments should not rely on these APIs without thorough testing against the specific `@solana/spl-token` version in use.

### 2. ElGamal Key Management

ElGamal keypairs are distinct from Solana ed25519 keypairs. There is no standardized key derivation path for ElGamal keys in the Solana ecosystem. Options under consideration:

- **Deterministic derivation** from the wallet's ed25519 private key (convenient but creates a single point of failure)
- **Separate key generation** with encrypted storage (more secure but adds UX complexity)
- **Hardware wallet integration** for ElGamal key storage (not yet available)

Loss of the ElGamal secret key means permanent loss of access to the confidential balance (the encrypted balance cannot be decrypted or withdrawn).

### 3. Compute Unit Requirements

Confidential transfers require approximately 4x the compute units of regular transfers. This impacts:

- Transaction cost (higher CU = higher priority fees in congested networks)
- Transaction size (ZK proofs add significant data to the transaction)
- Composability (fewer instructions can fit in a single transaction alongside a confidential transfer)

### 4. Token-2022 API Stability

The confidential transfer extension is part of Token-2022 but is still evolving:

- Instruction layouts may change between Token-2022 releases
- SDK helper functions may be renamed or restructured
- On-chain proof verification logic may be updated
- Account data layouts for the ConfidentialTransferAccount extension may change

### 5. Auditor Infrastructure

The auditor key provides compliance visibility, but production auditor integration requires:

- Secure auditor key generation and storage (HSM-backed)
- Automated decryption pipeline for transaction monitoring
- Compliance reporting tools that consume decrypted amounts
- Key rotation procedures without disrupting active transfers

None of this infrastructure exists as a standard component today.

### 6. Allowlist Scalability

The current allowlist model uses one PDA per approved address. For large-scale deployments:

- PDA creation costs ~0.002 SOL rent per entry
- Querying the full allowlist requires `getProgramAccounts` with filters
- No built-in pagination or indexing

Production deployments may want to move to off-chain verification proofs (e.g., Merkle proofs of KYC status) with on-chain root verification, reducing on-chain storage requirements.

### 7. Interaction with SSS-2 Features

Combining confidential transfers with SSS-2 compliance features raises unresolved questions:

- **Blacklist + confidential**: The transfer hook cannot inspect encrypted amounts. Blacklist enforcement would need to operate at the account level (block all transfers to/from blacklisted accounts) rather than amount level.
- **Seize + confidential**: The permanent delegate can initiate transfers, but seizing a confidential balance requires knowing the encrypted balance and generating valid proofs. This likely requires auditor key access.
- **Freeze + confidential**: Freezing a token account also freezes its confidential balance. This works correctly with the existing freeze mechanism.

---

## Events

The Privacy Program emits events for all state-changing operations:

| Instruction | Event | Key Fields |
|-------------|-------|------------|
| `initialize_privacy` | `PrivacyInitialized` | `privacy_config`, `stablecoin_config`, `authority`, `auto_approve`, `enforce_allowlist` |
| `update_privacy_config` | `PrivacyConfigUpdated` | `privacy_config`, `updated_by`, changed fields |
| `add_to_allowlist` | `AddressAllowlisted` | `privacy_config`, `address`, `label`, `added_by` |
| `remove_from_allowlist` | `AddressRemovedFromAllowlist` | `privacy_config`, `address`, `removed_by` |

The SSS program's `StablecoinInitialized` event already includes `enable_confidential_transfer: bool` to record whether confidential transfers were enabled at initialization.

---

## Roadmap

### Phase 1: Specification and On-Chain Foundation (Current)

- SSS-3 preset with `ConfidentialTransferMint` extension on the Token-2022 mint
- `enable_confidential_transfer` feature flag in `StablecoinConfig`
- Privacy program with allowlist management (PrivacyConfig + AllowlistEntry PDAs)
- This specification document as proof-of-concept documentation

### Phase 2: SDK Helpers

- `PrivacyModule` class in `@stbr/sss-core-sdk` for allowlist management
- ElGamal keypair generation helpers with deterministic derivation from wallet keys
- Wrapper functions for `configure_account`, `deposit`, `apply_pending_balance`, `withdraw`
- Compute budget estimation utilities for confidential transfer transactions

### Phase 3: Auditor Integration

- Auditor ElGamal key management (generation, rotation, backup)
- Automated decryption service for transaction monitoring
- Compliance reporting SDK (`@stbr/sss-compliance-sdk` extension)
- Dashboard integration for auditor visibility in the admin TUI and frontend

### Phase 4: Private Compliance

- Research and prototype combining SSS-2 blacklist enforcement with SSS-3 confidential transfers
- Account-level blacklist enforcement for confidential accounts (block all transfers, not amount-based)
- Auditor-assisted seizure flow (auditor decrypts balance, authority executes seizure)
- Encrypted compliance proofs (prove a transfer meets AML thresholds without revealing the amount)

---

## References

- [Token-2022 Confidential Transfers](https://spl.solana.com/token-2022/extensions#confidential-transfers) -- SPL documentation
- [Twisted ElGamal Encryption](https://docs.solanalabs.com/runtime/zk-token-proof) -- Solana ZK Token Proof documentation
- [spl-token v0.4 Confidential Transfer APIs](https://github.com/solana-labs/solana-program-library/tree/master/token/js) -- Experimental client-side helpers
- [SSS-1 Specification](./SSS-1.md) -- Base stablecoin preset
- [SSS-2 Specification](./SSS-2.md) -- Compliant stablecoin preset
- [Architecture Overview](./ARCHITECTURE.md) -- Three-layer model and PDA layout
- [Security Audit](./SECURITY_AUDIT.md) -- Comprehensive security analysis of on-chain programs
