# Common Design Patterns

This document covers operational patterns for stablecoin issuers and integrators, with TypeScript and Rust code examples for each.

---

## Pattern 1: Multi-sig Authority Rotation (2-Step Transfer + Squads)

### Problem

The master authority is a single keypair. If it's compromised, an attacker has full control. Even without a compromise, key rotation is required periodically.

### Solution: 2-Step Authority Transfer

The SSS program implements a 2-step transfer pattern: propose then accept. This prevents accidental transfer to an address that cannot sign (e.g., typo in the new authority).

```typescript
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";

// Step 1: Current authority proposes the transfer
await sssProgram.methods
  .proposeAuthorityTransfer(newAuthorityPubkey)
  .accounts({
    config: configPda,
    masterAuthority: currentAuthority.publicKey,
  })
  .signers([currentAuthority])
  .rpc();

// config.pending_authority is now set to newAuthorityPubkey
// AuthorityTransferProposed event is emitted

// Step 2: New authority accepts (must be signed by the new authority)
await sssProgram.methods
  .acceptAuthorityTransfer()
  .accounts({
    config: configPda,
    pendingAuthority: newAuthority.publicKey,
  })
  .signers([newAuthority])
  .rpc();

// AuthorityTransferAccepted event is emitted
// config.master_authority is now newAuthorityPubkey
```

### Solution: Squads Multisig as Authority

[Squads](https://squads.so) is an on-chain multisig protocol for Solana. Setting the master authority to a Squads vault means all role assignments, quota updates, and supply cap changes require M-of-N signatures.

```typescript
import { Squads } from "@sqds/sdk";

const squads = Squads.devnet(provider.wallet);

// Create a 2-of-3 multisig
const multisig = await squads.createMultisig(2, [
  member1.publicKey,
  member2.publicKey,
  member3.publicKey,
]);

const vaultPda = squads.getAuthorityPDA(multisig.publicKey, 1);

// Initialize the stablecoin with the Squads vault as master authority
await sssProgram.methods
  .initialize({
    name: "Secure USD",
    symbol: "SUSD",
    uri: "https://example.com/metadata.json",
    decimals: 6,
    enablePermanentDelegate: true,
    enableTransferHook: true,
    enableConfidentialTransfer: false,
    hookProgramId: TRANSFER_HOOK_PROGRAM_ID,
    supplyCap: new BN(0), // unlimited initially
  })
  .accounts({
    // masterAuthority is the Squads vault PDA
    masterAuthority: vaultPda,
    payer: payer.publicKey,
    // ... other accounts
  })
  .rpc();
```

### Checklist for Authority Rotation

1. Generate the new authority keypair in a hardware wallet (Ledger)
2. Call `propose_authority_transfer` from the current authority
3. Verify `config.pending_authority` matches the new address on-chain
4. Call `accept_authority_transfer` from the new authority
5. Verify `config.master_authority` is updated on-chain
6. Revoke the old keypair's access to all infrastructure
7. Update all off-chain configurations (backend `.env`, CLI `.sss-token.json`)

```typescript
// Verify rotation was successful
const config = await sssProgram.account.stablecoinConfig.fetch(configPda);
console.assert(
  config.masterAuthority.equals(newAuthorityPubkey),
  "Authority rotation failed"
);
console.assert(
  config.pendingAuthority.equals(PublicKey.default),
  "Pending authority not cleared"
);
```

---

## Pattern 2: Batch Operations

### Minting to Multiple Recipients in One Transaction

Solana's compute budget allows multiple instructions in a single transaction. Use this to batch mint operations for efficiency:

```typescript
import { Transaction, ComputeBudgetProgram } from "@solana/web3.js";

const recipients = [
  { address: recipientAta1, amount: new BN(1_000_000) },
  { address: recipientAta2, amount: new BN(2_000_000) },
  { address: recipientAta3, amount: new BN(500_000) },
];

const tx = new Transaction();

// Increase compute budget for multiple mints
tx.add(
  ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
);

for (const { address, amount } of recipients) {
  const ix = await sssProgram.methods
    .mintTokens(amount)
    .accounts({
      config: configPda,
      mint: mintAddress,
      minterQuota: minterQuotaPda,
      roleAccount: minterRolePda,
      recipientTokenAccount: address,
      minter: minter.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .instruction(); // .instruction() returns the raw Instruction, not sending tx

  tx.add(ix);
}

const sig = await provider.sendAndConfirm(tx, [minter]);
console.log("Batch mint signature:", sig);
```

### Batch Role Assignment

```typescript
const minters = [minter1.publicKey, minter2.publicKey, minter3.publicKey];
const tx = new Transaction();

for (const minterPk of minters) {
  const [rolePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("role"), configPda.toBuffer(), Buffer.from([0]), minterPk.toBuffer()],
    SSS_PROGRAM_ID
  );
  const [quotaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("minter_quota"), configPda.toBuffer(), minterPk.toBuffer()],
    SSS_PROGRAM_ID
  );

  tx.add(
    await sssProgram.methods
      .updateRoles(0, true) // roleType=0 (Minter), active=true
      .accounts({
        config: configPda,
        roleAccount: rolePda,
        user: minterPk,
        masterAuthority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );

  tx.add(
    await sssProgram.methods
      .updateMinter(new BN(10_000_000_000_000)) // 10M tokens quota
      .accounts({
        config: configPda,
        minterQuota: quotaPda,
        minter: minterPk,
        masterAuthority: authority.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction()
  );
}

await provider.sendAndConfirm(tx, [authority]);
```

---

## Pattern 3: Emergency Pause + Seizure Flow

### Problem

A security incident (hack, exploit, regulatory directive) requires halting all activity and potentially recovering funds.

### Step 1: Emergency Pause

```typescript
async function emergencyPause(
  sssProgram: Program,
  configPda: PublicKey,
  pauser: Keypair
) {
  // Check current state
  const config = await sssProgram.account.stablecoinConfig.fetch(configPda);
  if (config.paused) {
    console.log("Already paused");
    return;
  }

  const [pauserRolePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("role"),
      configPda.toBuffer(),
      Buffer.from([2]), // ROLE_PAUSER = 2
      pauser.publicKey.toBuffer(),
    ],
    SSS_PROGRAM_ID
  );

  await sssProgram.methods
    .pause()
    .accounts({
      config: configPda,
      roleAccount: pauserRolePda,
      authority: pauser.publicKey,
    })
    .signers([pauser])
    .rpc({ commitment: "confirmed" });

  console.log("Stablecoin paused. All mint/burn operations blocked.");
}
```

### Step 2: Freeze Specific Accounts

```typescript
async function freezeAccount(
  sssProgram: Program,
  configPda: PublicKey,
  mintAddress: PublicKey,
  tokenAccount: PublicKey,
  pauser: Keypair
) {
  const [pauserRolePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("role"), configPda.toBuffer(), Buffer.from([2]), pauser.publicKey.toBuffer()],
    SSS_PROGRAM_ID
  );

  await sssProgram.methods
    .freezeTokenAccount()
    .accounts({
      config: configPda,
      mint: mintAddress,
      tokenAccount: tokenAccount,
      roleAccount: pauserRolePda,
      authority: pauser.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([pauser])
    .rpc({ commitment: "confirmed" });

  console.log("Account frozen:", tokenAccount.toString());
}
```

### Step 3: Blacklist the Offender (SSS-2)

```typescript
async function blacklistOffender(
  sssProgram: Program,
  configPda: PublicKey,
  offenderWallet: PublicKey,
  reason: string,
  blacklister: Keypair
) {
  const [blacklisterRolePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("role"), configPda.toBuffer(), Buffer.from([3]), blacklister.publicKey.toBuffer()],
    SSS_PROGRAM_ID
  );

  const [blacklistEntryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("blacklist"), configPda.toBuffer(), offenderWallet.toBuffer()],
    SSS_PROGRAM_ID
  );

  await sssProgram.methods
    .addToBlacklist(reason)
    .accounts({
      config: configPda,
      blacklistEntry: blacklistEntryPda,
      address: offenderWallet,
      roleAccount: blacklisterRolePda,
      authority: blacklister.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([blacklister])
    .rpc({ commitment: "confirmed" });

  console.log("Blacklisted:", offenderWallet.toString());
}
```

### Step 4: Seize Funds (SSS-2)

```typescript
async function seizeFunds(
  sssProgram: Program,
  configPda: PublicKey,
  mintAddress: PublicKey,
  sourceTokenAccount: PublicKey,
  treasuryTokenAccount: PublicKey,
  amount: BN,
  seizer: Keypair
) {
  const [seizerRolePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("role"), configPda.toBuffer(), Buffer.from([4]), seizer.publicKey.toBuffer()],
    SSS_PROGRAM_ID
  );

  await sssProgram.methods
    .seize(amount)
    .accounts({
      config: configPda,
      mint: mintAddress,
      sourceTokenAccount: sourceTokenAccount,
      destinationTokenAccount: treasuryTokenAccount,
      roleAccount: seizerRolePda,
      seizer: seizer.publicKey,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
    })
    .signers([seizer])
    .rpc({ commitment: "confirmed" });

  console.log(`Seized ${amount.toString()} base units to treasury`);
}
```

### Step 5: Resume Operations

```typescript
await sssProgram.methods
  .unpause()
  .accounts({
    config: configPda,
    roleAccount: pauserRolePda,
    authority: pauser.publicKey,
  })
  .signers([pauser])
  .rpc();
```

---

## Pattern 4: Supply Cap Management

### Setting an Initial Cap

```typescript
// Set a $10M cap (with 6 decimals = 10,000,000,000,000 base units)
const cap = new BN(10_000_000).mul(new BN(1_000_000));

await sssProgram.methods
  .initialize({
    // ...
    supplyCap: cap,
  })
  // ...
  .rpc();
```

### Monitoring Cap Utilization

```typescript
async function getCapUtilization(
  sssProgram: Program,
  configPda: PublicKey
) {
  const config = await sssProgram.account.stablecoinConfig.fetch(configPda);

  const utilizationBps = config.supplyCap.isZero()
    ? 0
    : config.totalMinted.mul(new BN(10000)).div(config.supplyCap).toNumber();

  return {
    totalMinted: config.totalMinted.toString(),
    supplyCap: config.supplyCap.toString(),
    utilizationBps,
    utilizationPercent: utilizationBps / 100,
    remainingCapacity: config.supplyCap.isZero()
      ? "unlimited"
      : config.supplyCap.sub(config.totalMinted).toString(),
  };
}
```

---

## Pattern 5: Quota-Based Minting Cycles

### Monthly Quota Reset

Many stablecoin issuers grant minters a monthly allocation. At the start of each month, the master authority resets each minter's `minted` counter, making the full quota available again.

```typescript
async function resetMonthlyQuotas(
  sssProgram: Program,
  configPda: PublicKey,
  minters: PublicKey[],
  authority: Keypair
) {
  const tx = new Transaction();

  for (const minterPk of minters) {
    const [quotaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter_quota"), configPda.toBuffer(), minterPk.toBuffer()],
      SSS_PROGRAM_ID
    );

    tx.add(
      await sssProgram.methods
        .resetMinterQuota()
        .accounts({
          config: configPda,
          minterQuota: quotaPda,
          minter: minterPk,
          masterAuthority: authority.publicKey,
        })
        .instruction()
    );
  }

  const sig = await provider.sendAndConfirm(tx, [authority]);

  // Audit: log the reset event for each minter
  console.log(`Monthly quota reset for ${minters.length} minters. Tx: ${sig}`);
}
```

### Scheduled Reset with Cron (Backend)

```typescript
// Run this via node-cron or a serverless scheduler
import cron from "node-cron";

// First day of each month at 00:00 UTC
cron.schedule("0 0 1 * *", async () => {
  const activeMinters = await getActiveMinters(configPda);
  await resetMonthlyQuotas(sssProgram, configPda, activeMinters, authorityKeypair);
  console.log(`[${new Date().toISOString()}] Monthly quota reset complete`);
});
```

### Checking Remaining Quota

```typescript
async function getRemainingQuota(
  sssProgram: Program,
  configPda: PublicKey,
  minterPk: PublicKey
): Promise<BN> {
  const [quotaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("minter_quota"), configPda.toBuffer(), minterPk.toBuffer()],
    SSS_PROGRAM_ID
  );

  const quota = await sssProgram.account.minterQuota.fetch(quotaPda);
  return quota.quota.sub(quota.minted);
}
```

---

## Anti-Patterns to Avoid

### Storing Secrets in Accounts

Never store private keys, passwords, or secrets in on-chain accounts. All account data on Solana is publicly readable. Use the key-derivation patterns (PDA) for program-controlled signers.

### Missing `checked_add`/`checked_sub`

Always use checked arithmetic. The SSS program does this internally, but if you're building a wrapper or helper program that processes amounts, use:

```rust
let new_total = old_total.checked_add(amount).ok_or(ErrorCode::MathOverflow)?;
```

### Passing Unchecked Module PDAs

When reading module PDAs in `remaining_accounts`, always verify:
1. The discriminator matches the expected account type
2. The `stablecoin_config` field matches the current stablecoin's config PDA
3. The account is owned by the expected program

### Forgetting `{ commitment: "confirmed" }` in Tests

When using Anchor's test environment with Surfpool/test-validator, always specify `{ commitment: "confirmed" }` on RPC calls to avoid blockhash expiration issues:

```typescript
await program.methods.mintTokens(amount).accounts({...}).rpc({ commitment: "confirmed" });
```
