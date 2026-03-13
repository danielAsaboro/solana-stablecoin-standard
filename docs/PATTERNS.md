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

## Pattern 2: Timelocked Parameter Changes

### Problem

A compromised authority can change supply caps or add malicious minters instantly. A timelock ensures parameter changes are visible to the community before taking effect.

### Setup

```typescript
// Initialize the timelock module with a 48-hour delay
const delay = 48 * 60 * 60; // 172800 seconds

const [timelockConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("timelock_config"), stablecoinConfigPda.toBuffer()],
  TIMELOCK_PROGRAM_ID
);

await timelockProgram.methods
  .initializeTimelockConfig(new BN(delay))
  .accounts({
    timelockConfig: timelockConfigPda,
    stablecoinConfig: stablecoinConfigPda,
    authority: multisigVaultPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Scheduling and Executing a Caps Change

```typescript
// Day 0: Schedule a global cap increase
const opId = await timelockProgram.methods
  .scheduleOp({
    // Encoded instruction data for the caps update
    targetProgram: CAPS_PROGRAM_ID,
    data: capsProgram.coder.instruction.encode("updateCapsConfig", {
      newGlobalCap: new BN(200_000_000_000_000),
      newPerMinterCap: new BN(20_000_000_000_000),
    }),
  })
  .accounts({
    timelockConfig: timelockConfigPda,
    authority: multisigVaultPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

// The opId is a u64 counter from timelockConfig.total_ops

console.log(
  `Scheduled: op will be executable after ${new Date(Date.now() + delay * 1000).toISOString()}`
);

// Day 2: Execute the scheduled operation
const opIdBuf = Buffer.alloc(8);
opIdBuf.writeBigUInt64LE(BigInt(opId));
const [pendingOpPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("pending_op"), timelockConfigPda.toBuffer(), opIdBuf],
  TIMELOCK_PROGRAM_ID
);

await timelockProgram.methods
  .executeOp(new BN(opId))
  .accounts({
    timelockConfig: timelockConfigPda,
    pendingOp: pendingOpPda,
    authority: multisigVaultPda,
    // Target accounts for the caps update
    capsConfig: capsConfigPda,
    capsProgram: CAPS_PROGRAM_ID,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
```

### Cancelling a Pending Operation

```typescript
// If a scheduled operation is discovered to be incorrect, cancel it
await timelockProgram.methods
  .cancelOp(new BN(opId))
  .accounts({
    timelockConfig: timelockConfigPda,
    pendingOp: pendingOpPda,
    authority: multisigVaultPda,
  })
  .rpc();

console.log("Operation cancelled — it will never be executable");
```

---

## Pattern 3: Batch Operations

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

## Pattern 4: Emergency Pause + Seizure Flow

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

## Pattern 5: Supply Cap Management

### Setting an Initial Cap

```typescript
// Set a $10M cap (with 6 decimals = 10,000,000,000,000 base units)
const cap = new BN(10_000_000).mul(new BN(1_000_000));

// Option A: Set at initialization
await sssProgram.methods
  .initialize({
    // ...
    supplyCap: cap,
  })
  // ...
  .rpc();

// Option B: Use the SSS-Caps module for external management
await capsProgram.methods
  .initializeCapsConfig(cap, new BN(1_000_000).mul(new BN(1_000_000)))
  .accounts({ /* ... */ })
  .rpc();
```

### Monitoring Cap Utilization

```typescript
async function getCapUtilization(
  sssProgram: Program,
  capsProgram: Program,
  configPda: PublicKey,
  capsConfigPda: PublicKey
) {
  const [config, caps] = await Promise.all([
    sssProgram.account.stablecoinConfig.fetch(configPda),
    capsProgram.account.capsConfig.fetch(capsConfigPda),
  ]);

  const utilizationBps = caps.globalCap.isZero()
    ? 0
    : config.totalMinted.mul(new BN(10000)).div(caps.globalCap).toNumber();

  return {
    totalMinted: config.totalMinted.toString(),
    globalCap: caps.globalCap.toString(),
    utilizationBps,
    utilizationPercent: utilizationBps / 100,
    remainingCapacity: caps.globalCap.sub(config.totalMinted).toString(),
  };
}
```

### Adjusting the Cap

```typescript
// Increase cap to $20M (must be done by caps authority)
await capsProgram.methods
  .updateCapsConfig(
    new BN(20_000_000).mul(new BN(1_000_000)), // new global cap
    new BN(2_000_000).mul(new BN(1_000_000))   // new per-minter cap
  )
  .accounts({
    capsConfig: capsConfigPda,
    stablecoinConfig: stablecoinConfigPda,
    authority: capsAuthority.publicKey,
  })
  .signers([capsAuthority])
  .rpc();
```

### Removing the Cap (Unlimited Supply)

```typescript
// Setting global_cap to 0 means no cap is enforced
await capsProgram.methods
  .updateCapsConfig(
    new BN(0), // 0 = unlimited
    new BN(0)  // 0 = unlimited per minter
  )
  .accounts({ /* ... */ })
  .rpc();
```

---

## Pattern 6: Quota-Based Minting Cycles

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

## Pattern 7: Allowlist-Only Mode (Private Stablecoin Distribution)

### Use Case

A regulated stablecoin issuer wants only KYC-verified addresses to hold the token. Using the SSS-Allowlist module, minting is restricted to addresses on an approved list.

### Setup

```typescript
// Initialize allowlist module in "AllowlistOnly" mode
const [allowlistConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("allowlist_config"), stablecoinConfigPda.toBuffer()],
  SSS_ALLOWLIST_PROGRAM_ID
);

await allowlistProgram.methods
  .initializeAllowlistConfig({ allowlistOnly: {} }) // mode: AllowlistOnly
  .accounts({
    allowlistConfig: allowlistConfigPda,
    stablecoinConfig: stablecoinConfigPda,
    authority: complianceTeam.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .signers([complianceTeam])
  .rpc();
```

### Adding KYC-Verified Addresses

```typescript
async function approveAddress(
  allowlistProgram: Program,
  allowlistConfigPda: PublicKey,
  address: PublicKey,
  label: string,
  authority: Keypair
) {
  const [entryPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("allowlist_entry"),
      allowlistConfigPda.toBuffer(),
      address.toBuffer(),
    ],
    SSS_ALLOWLIST_PROGRAM_ID
  );

  await allowlistProgram.methods
    .addToAllowlist(label)
    .accounts({
      allowlistConfig: allowlistConfigPda,
      allowlistEntry: entryPda,
      address: address,
      authority: authority.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  console.log(`Approved ${address.toString()} (${label})`);
}

// Bulk onboard KYC-verified users
const kycUsers = [
  { address: institutionalClient1, label: "Acme Corp - KYC 2026-01-01" },
  { address: institutionalClient2, label: "Beta Fund - KYC 2026-02-15" },
];

for (const { address, label } of kycUsers) {
  await approveAddress(allowlistProgram, allowlistConfigPda, address, label, complianceTeam);
}
```

### Minting to Allowlisted Address

```typescript
// The allowlist entry PDA must be in remaining_accounts for the constraint to be checked
const [allowlistEntryPda] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("allowlist_entry"),
    allowlistConfigPda.toBuffer(),
    recipientAddress.toBuffer(),
  ],
  SSS_ALLOWLIST_PROGRAM_ID
);

await sssProgram.methods
  .mintTokens(new BN(1_000_000_000)) // 1000 tokens
  .accounts({ /* ... standard accounts ... */ })
  .remainingAccounts([
    { pubkey: allowlistConfigPda, isSigner: false, isWritable: false },
    { pubkey: allowlistEntryPda, isSigner: false, isWritable: false },
  ])
  .rpc();
```

### Switching Between Open and AllowlistOnly Modes

```typescript
// Temporarily open the stablecoin for public minting
await allowlistProgram.methods
  .updateAllowlistMode({ open: {} })
  .accounts({
    allowlistConfig: allowlistConfigPda,
    authority: complianceTeam.publicKey,
  })
  .rpc();

// Switch back to allowlist-only
await allowlistProgram.methods
  .updateAllowlistMode({ allowlistOnly: {} })
  .accounts({
    allowlistConfig: allowlistConfigPda,
    authority: complianceTeam.publicKey,
  })
  .rpc();
```

### Removing an Address (Offboarding)

```typescript
async function revokeAddress(
  allowlistProgram: Program,
  allowlistConfigPda: PublicKey,
  address: PublicKey,
  authority: Keypair
) {
  const [entryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("allowlist_entry"), allowlistConfigPda.toBuffer(), address.toBuffer()],
    SSS_ALLOWLIST_PROGRAM_ID
  );

  await allowlistProgram.methods
    .removeFromAllowlist()
    .accounts({
      allowlistConfig: allowlistConfigPda,
      allowlistEntry: entryPda,
      address: address,
      authority: authority.publicKey,
    })
    .signers([authority])
    .rpc();

  console.log(`Revoked ${address.toString()}`);
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
