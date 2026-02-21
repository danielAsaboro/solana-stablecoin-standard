# SDK Reference

## Installation

```bash
yarn add @stbr/sss-core-sdk @stbr/sss-compliance-sdk
```

## Core SDK (`@stbr/sss-core-sdk`)

### SolanaStablecoin Class

The main entry point. Use static factory methods to instantiate.

#### Create a New Stablecoin

```typescript
import { SolanaStablecoin } from "@stbr/sss-core-sdk";
import { Presets } from "@stbr/sss-core-sdk";

const { stablecoin, mintKeypair, instruction } = await SolanaStablecoin.create(
  connection,
  {
    ...Presets.SSS_2,
    name: "My USD",
    symbol: "MUSD",
    uri: "https://example.com/meta.json",
    decimals: 6,
    authority: wallet.publicKey,
    transferHookProgramId: HOOK_PROGRAM_ID,
  }
);

// Sign and send the transaction
const tx = new Transaction().add(instruction);
await sendAndConfirmTransaction(connection, tx, [wallet, mintKeypair]);
```

#### Load an Existing Stablecoin

```typescript
const stablecoin = await SolanaStablecoin.load(connection, mintAddress);
const config = await stablecoin.getConfig();
```

### Operations

All write methods return a `TransactionInstruction`. Build a transaction, add the instruction, and sign.

```typescript
// Mint tokens
const mintIx = await stablecoin.mint({
  amount: new BN(1_000_000),
  recipientTokenAccount: recipientAta,
  minter: minterKeypair.publicKey,
});

// Burn tokens
const burnIx = await stablecoin.burn({
  amount: new BN(500_000),
  fromTokenAccount: burnerAta,
  burner: burnerKeypair.publicKey,
});

// Freeze/thaw
const freezeIx = await stablecoin.freeze({ tokenAccount: ata, authority: pauserPubkey });
const thawIx = await stablecoin.thaw({ tokenAccount: ata, authority: pauserPubkey });

// Pause/unpause
const pauseIx = await stablecoin.pause({ authority: pauserPubkey });
const unpauseIx = await stablecoin.unpause({ authority: pauserPubkey });

// Manage roles
const roleIx = await stablecoin.updateRoles({
  roleType: RoleType.Minter,
  user: newMinter,
  active: true,
  authority: masterAuthority,
});

// Update minter quota
const quotaIx = await stablecoin.updateMinter({
  minter: minterPubkey,
  quota: new BN(1_000_000_000),
  authority: masterAuthority,
});
```

### Read Methods

```typescript
const config = await stablecoin.getConfig();
const supply = await stablecoin.getSupply();
const quota = await stablecoin.getMinterQuota(minterPubkey);
const role = await stablecoin.getRole(RoleType.Minter, userPubkey);
```

### PDA Helpers

```typescript
import { getConfigAddress, getRoleAddress, getMinterQuotaAddress, getBlacklistEntryAddress } from "@stbr/sss-core-sdk";

const [configPda, bump] = getConfigAddress(programId, mint);
const [rolePda] = getRoleAddress(programId, configPda, RoleType.Minter, user);
const [quotaPda] = getMinterQuotaAddress(programId, configPda, minter);
const [blPda] = getBlacklistEntryAddress(programId, configPda, address);
```

### Presets

```typescript
import { Presets } from "@stbr/sss-core-sdk";

// SSS-1: Minimal
Presets.SSS_1 = {
  enablePermanentDelegate: false,
  enableTransferHook: false,
  defaultAccountFrozen: false,
};

// SSS-2: Compliant
Presets.SSS_2 = {
  enablePermanentDelegate: true,
  enableTransferHook: true,
  defaultAccountFrozen: false,
};
```

## Compliance SDK (`@stbr/sss-compliance-sdk`)

### Compliance Module (via SolanaStablecoin)

```typescript
// Blacklist operations
const addIx = await stablecoin.compliance.blacklistAdd({
  address: suspiciousUser,
  reason: "Suspicious activity",
  authority: blacklisterPubkey,
});

const removeIx = await stablecoin.compliance.blacklistRemove({
  address: clearedUser,
  authority: blacklisterPubkey,
});

// Seize tokens
const seizeIx = await stablecoin.compliance.seize({
  fromTokenAccount: targetAta,
  toTokenAccount: treasuryAta,
  amount: new BN(100_000),
  authority: seizerPubkey,
});

// Query blacklist
const isBlacklisted = await stablecoin.compliance.isBlacklisted(address);
const allBlacklisted = await stablecoin.compliance.getBlacklist();
const entry = await stablecoin.compliance.getBlacklistEntry(address);
```
