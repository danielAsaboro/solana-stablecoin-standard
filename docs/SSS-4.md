# SSS-4: Privacy + Compliance Stablecoin

| Field | Value |
|-------|-------|
| Standard | SSS-4 |
| Title | Privacy + Compliance — Confidential Transfers with Blacklist Enforcement |
| Status | Draft |
| Requires | SSS-2 (Blacklist), SSS-3 (Confidential Transfers) |
| Programs | `sss` (main), `transfer_hook` or `sss-4-hook` (privacy-enforcement hook) |

---

## Abstract

SSS-4 combines the privacy capabilities of SSS-3 (El Gamal encrypted amounts via Token-2022 ConfidentialTransferMint) with the compliance enforcement of SSS-2 (blacklist via Transfer Hook). This combination presents a fundamental design challenge: the transfer hook is invoked on `transfer_checked` where amounts may be encrypted, yet compliance enforcement must still block blacklisted parties.

SSS-4 resolves this by separating **party enforcement** (blacklist, allowlist) from **amount enforcement** (supply caps, quotas). The hook checks whether a party is permitted to transact — not the amount. Since blacklisting is identity-based, not amount-based, this enforcement works correctly even when amounts are hidden.

---

## Why Naive Combination Does Not Work

### The Problem

The SSS-3 confidential transfer flow looks like:

```
1. User deposits to pending confidential balance (public → encrypted)
2. User applies pending balance (pending → available, both encrypted)
3. User initiates confidential transfer (encrypted → encrypted, with ZK proof)
```

In step 3, the transfer hook is invoked. At this point:

- The `amount` parameter in the hook instruction is `0` (or the encrypted amount's ciphertext length, not the actual value)
- The actual transfer amount is encoded in the El Gamal ciphertexts attached to the instruction
- The hook cannot read the encrypted amount without the recipient's private key

### What This Means for SSS-4

**The hook CAN enforce (identity-based)**:
- Is the source account owner blacklisted?
- Is the destination account owner on the allowlist?
- Is either party on the OFAC sanctions list?

**The hook CANNOT enforce (amount-based)**:
- Is the transfer below a reporting threshold?
- Would the transfer violate a per-account balance cap?

SSS-4 takes the position that **party-based enforcement is sufficient for regulatory compliance**, because:
1. OFAC sanctions target entities, not transaction sizes
2. Supply caps are enforced at mint time (not transfer time)
3. Transfer amount monitoring is the auditor's role (via the auditor key), not the protocol's role

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Token-2022 Mint                          │
│                                                             │
│  Extensions:                                                │
│  ├── MetadataPointer                                        │
│  ├── ConfidentialTransferMint                               │
│  │   ├── authority: config PDA                             │
│  │   ├── auto_approve_new_accounts: false                  │
│  │   └── auditor_elgamal_pubkey: <auditor key>             │
│  ├── PermanentDelegate (for seizure)                        │
│  └── TransferHook → sss-4-hook program                     │
└─────────────────────────────────────────────────────────────┘
                          │
                          │ CPI on every transfer_checked
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   SSS-4 Hook Program                        │
│                                                             │
│  execute(ctx) {                                             │
│    // Check source owner blacklist PDA (SSS-2 style)        │
│    let src_owner = get_account_owner(source_token_account); │
│    if blacklist_pda_exists(config, src_owner) {             │
│      return Err(SourceBlacklisted);                         │
│    }                                                        │
│                                                             │
│    // Check destination owner blacklist PDA                 │
│    let dst_owner = get_account_owner(dest_token_account);   │
│    if blacklist_pda_exists(config, dst_owner) {             │
│      return Err(DestinationBlacklisted);                    │
│    }                                                        │
│                                                             │
│    // Check source owner allowlist PDA (optional)          │
│    if allowlist_mode == AllowlistOnly {                     │
│      if !allowlist_pda_exists(allowlist_config, src_owner) {│
│        return Err(NotAllowlisted);                          │
│      }                                                      │
│    }                                                        │
│                                                             │
│    Ok(()) // Transfer proceeds                              │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

### ExtraAccountMetas Layout for SSS-4

The SSS-4 hook requires the following additional accounts, resolved dynamically via `Seed::AccountData`:

```rust
// ExtraAccountMetas stored in ["extra-account-metas", mint]
[
    // Account 0: SSS stablecoin config PDA
    ExtraAccountMeta::new_with_seeds(
        &[Seed::Literal(b"stablecoin"), Seed::AccountKey(0)], // mint is account 0 in transfer
        false,  // is_signer
        false,  // is_writable
    ),
    // Account 1: BlacklistEntry PDA for source token account owner
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal(b"blacklist"),
            Seed::AccountKey(4),   // config PDA (account index 4 = extra_acct_metas[0])
            Seed::AccountData { account_index: 2, data_index: 32, length: 32 },
            // data_index 32: owner field in source TokenAccount (offset 32)
        ],
        false,
        false,
    ),
    // Account 2: BlacklistEntry PDA for destination token account owner
    ExtraAccountMeta::new_with_seeds(
        &[
            Seed::Literal(b"blacklist"),
            Seed::AccountKey(4),
            Seed::AccountData { account_index: 3, data_index: 32, length: 32 },
        ],
        false,
        false,
    ),
]
```

---

## The Auditor Key Pattern

### Purpose

The GENIUS Act and similar regulations require that a designated compliance entity can audit transfer amounts. The `ConfidentialTransferMint` extension supports an optional auditor El Gamal public key. When set, every confidential transfer includes a third ciphertext encrypted under the auditor's key.

### Setup

```typescript
import { generateElGamalKeypair } from "@solana/spl-token";

// Generate auditor keypair (store private key in HSM)
const auditorKeypair = generateElGamalKeypair();
const auditorPublicKey = auditorKeypair.publicKey;

// Initialize SSS-4 stablecoin with auditor key
await sssProgram.methods.initialize({
  name: "Compliant Privacy USD",
  symbol: "CPUSD",
  uri: "https://example.com/cpusd/metadata.json",
  decimals: 6,
  enablePermanentDelegate: true,
  enableTransferHook: true,
  enableConfidentialTransfer: true,
  hookProgramId: SSS_4_HOOK_PROGRAM_ID,
  supplyCap: new BN(0),
  // The auditor key is set in the ConfidentialTransferMint extension
  // by the Token-2022 extension config, not directly in SSS init
}).rpc();

// After init, configure the ConfidentialTransferMint extension
// to set the auditor key via Token-2022's update_confidential_transfer_mint
```

### How the Auditor Decrypts

When a regulator requests transaction details:

```typescript
// Auditor decrypts a transfer using their private key
import { decryptWithElGamal } from "@solana/spl-token";

// Fetch the transaction
const tx = await connection.getTransaction(signature, {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0,
});

// Extract the auditor ciphertext from the instruction data
const auditorCiphertext = extractAuditorCiphertext(tx);

// Decrypt
const transferAmount = decryptWithElGamal(auditorCiphertext, auditorPrivateKey);
console.log("Transfer amount:", transferAmount.toString());
```

---

## Implementation Notes

### Program Structure

The SSS-4 implementation requires either:

**Option A: Enhanced Transfer Hook** — Extend the existing `transfer_hook` program to also check allowlist PDAs when the confidential transfer extension is active. The hook already checks blacklist PDAs; add a check for the privacy program's allowlist.

**Option B: Dedicated SSS-4 Hook** — A new `sss-4-hook` program that handles both blacklist and allowlist enforcement, with separate `ExtraAccountMetas` configuration.

Option B is recommended for clean separation and independent auditing.

### Initialization Sequence

```
1. anchor deploy sss
2. anchor deploy sss-4-hook
3. SSS: initialize(enable_confidential_transfer=true, enable_transfer_hook=true,
                   enable_permanent_delegate=true, hook_program=sss_4_hook)
4. Transfer Hook: initialize_extra_account_metas (registers blacklist + allowlist PDAs)
5. Privacy: initialize_privacy (sets allowlist authority, auto_approve=false)
6. ConfidentialTransfer: configure auditor key (via Token-2022 update instruction)
```

### Account Layout in Transfer

When a confidential transfer occurs on an SSS-4 stablecoin, the transaction includes:

```
Standard Token-2022 accounts:
  [0] source_token_account
  [1] mint
  [2] destination_token_account
  [3] source_owner (signer)

Extra account metas resolved by Token-2022:
  [4] extra_account_metas PDA
  [5] sss_config PDA (from ExtraAccountMeta seeds)
  [6] blacklist_entry_source (may not exist → transfer allowed)
  [7] blacklist_entry_dest (may not exist → transfer allowed)
  [8] privacy_config (Privacy program)
  [9] allowlist_entry_source (may not exist → transfer blocked if auto_approve=false)
```

### Seizure of Confidential Balances

The `seize` instruction uses the config PDA as permanent delegate to force-transfer tokens. For SSS-4, seizing a confidential balance requires converting it to a public balance first:

```
Seizer calls: Token-2022 withdraw_withheld_tokens (to convert confidential → public)
Then calls: SSS seize (transfers public balance to treasury)
```

This is a known limitation of the confidential transfer flow: seizure of encrypted balances requires the account holder's cooperation to decrypt, unless the issuer has established a recovery mechanism during account setup.

---

## Security Model

### Trust Assumptions

| Party | What They See | What They Cannot See |
|-------|--------------|---------------------|
| Anyone (public) | Transaction happened, parties involved | Transfer amount |
| Transfer Hook Program | Token account addresses, owner addresses | Transfer amount |
| Auditor (with key) | All transfer amounts | Private keys |
| Issuer Authority | All compliance actions | Transfer amounts (unless auditor key is also held) |
| Blacklister | Identity of blacklisted party | Transfer amounts |

### Attack Vectors Considered

1. **Blacklist bypass via confidential balance**: A blacklisted user cannot transfer even if the amount is hidden. The hook checks identity, not amount.

2. **Allowlist bypass**: A non-allowlisted user cannot initiate confidential transfers because the hook blocks them.

3. **Auditor key compromise**: If the auditor's El Gamal private key is stolen, all historical and future transfer amounts are exposed. The auditor key must be stored in a HSM (Hardware Security Module).

4. **Replay of audit ciphertexts**: Each transfer's auditor ciphertext is bound to the specific transfer (nonce included). Replaying it yields the same decrypted amount but cannot create new transfers.

5. **Forced account configuration**: The Privacy Program's allowlist prevents unauthorized addresses from enabling confidential mode. Even if a user configures their token account for confidential transfers, transfers will fail if they are not on the allowlist.

---

## TypeScript Examples

### Configure Account for Confidential Transfers (SSS-4)

```typescript
import {
  configureAccount,
  getAssociatedTokenAddress,
  generateElGamalKeypair,
} from "@solana/spl-token";

// User generates their El Gamal keypair (stored client-side, NOT on-chain)
const userElGamalKeypair = generateElGamalKeypair();

// Configure the token account for confidential transfers
const userAta = await getAssociatedTokenAddress(mint, user.publicKey, false, TOKEN_2022_PROGRAM_ID);

await configureAccount(
  connection,
  user,
  userAta,
  mint,
  { publicKey: userElGamalKeypair.publicKey },
  [], // multisigners
  TOKEN_2022_PROGRAM_ID
);
```

### Deposit to Confidential Balance

```typescript
import { deposit } from "@solana/spl-token";

// Move tokens from public balance to confidential pending balance
await deposit(
  connection,
  user,
  userAta,
  mint,
  user,
  1_000_000n, // 1 token (6 decimals) as BigInt
  6,
  [],
  TOKEN_2022_PROGRAM_ID
);
```

### Apply Pending Balance

```typescript
import { applyPendingBalance } from "@solana/spl-token";

// Apply the pending balance to available confidential balance
await applyPendingBalance(
  connection,
  user,
  userAta,
  userElGamalKeypair,
  0n, // expected pending balance credits (counter)
  1_000_000n, // expected pending balance amount
  TOKEN_2022_PROGRAM_ID
);
```

### Check Allowlist Before Confidential Transfer

```typescript
async function canTransferConfidentially(
  privacyProgram: Program,
  privacyConfigPda: PublicKey,
  sourceOwner: PublicKey,
  destOwner: PublicKey
): Promise<{ allowed: boolean; reason?: string }> {
  const config = await privacyProgram.account.privacyConfig.fetch(privacyConfigPda);

  if (config.autoApprove) {
    return { allowed: true };
  }

  // Check source
  const [srcAllowlistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowlist"), privacyConfigPda.toBuffer(), sourceOwner.toBuffer()],
    PRIVACY_PROGRAM_ID
  );
  const srcEntry = await connection.getAccountInfo(srcAllowlistPda);
  if (!srcEntry) return { allowed: false, reason: "Source not on privacy allowlist" };

  // Check destination
  const [dstAllowlistPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowlist"), privacyConfigPda.toBuffer(), destOwner.toBuffer()],
    PRIVACY_PROGRAM_ID
  );
  const dstEntry = await connection.getAccountInfo(dstAllowlistPda);
  if (!dstEntry) return { allowed: false, reason: "Destination not on privacy allowlist" };

  return { allowed: true };
}
```
