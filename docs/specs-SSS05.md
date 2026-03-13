# SSS-5: Multi-Issuer Stablecoin

| Field | Value |
|-------|-------|
| Standard | SSS-5 |
| Title | Multi-Issuer Consortium Stablecoin |
| Status | Draft |
| Requires | SSS-1 |
| Use Case | Multiple licensed banks or financial institutions issuing under a single token |

---

## Abstract

SSS-5 defines a stablecoin where a single Token-2022 mint is shared by multiple independent issuers (e.g., a consortium of regional banks), each with their own independently managed issuance quota. A federated governance model allows a master consortium authority to delegate sub-quotas to each member institution.

---

## Use Cases

1. **Bank consortium stablecoin**: Five regional banks collectively issue a shared dollar stablecoin. Each bank has its own compliance team and minting key, but all tokens are fungible.

2. **Multi-jurisdiction CBDC**: A central bank consortium (e.g., BIS mBridge participants) where each member central bank can issue up to its allocated quota.

3. **Federated remittance network**: Multiple licensed money services businesses issue from the same mint to avoid fragmented liquidity.

---

## Architecture

```
                    Consortium Authority
                         │
                         │ master authority
                         ▼
                  StablecoinConfig PDA
                  (one mint, one config)
                         │
           ┌─────────────┼─────────────┐
           ▼             ▼             ▼
    MinterQuota    MinterQuota    MinterQuota
    [Bank A]       [Bank B]       [Bank C]
    quota: 10M     quota: 5M      quota: 3M
    minted: 2M     minted: 1M     minted: 0M
```

SSS-5 is a governance configuration on top of SSS-1. No new on-chain program is required. The multi-issuer semantics are achieved entirely through the role and quota system:

- **One mint, one config**: All issuers share a single Token-2022 mint
- **Per-issuer quota**: Each issuer has a `MinterQuota` PDA with their allocated capacity
- **Independent minting keys**: Each issuer has their own `RoleAccount` PDA with role type 0 (Minter)
- **Consortium governance**: The master authority manages quota allocation; individual issuers control their own minting operations

---

## Quota Federation

### Master Authority Role

The consortium authority (e.g., a Squads multisig controlled by the consortium board):

```typescript
// Consortium creates the stablecoin with supply cap = total consortium limit
await sssProgram.methods.initialize({
  name: "Consortium Dollar",
  symbol: "CUSD",
  uri: "https://consortium.finance/cusd/metadata.json",
  decimals: 6,
  enablePermanentDelegate: false,
  enableTransferHook: false,
  enableConfidentialTransfer: false,
  hookProgramId: PublicKey.default,
  supplyCap: new BN(100_000_000).mul(new BN(1_000_000)), // $100M total
}).rpc();
```

### Delegating Quotas to Member Banks

```typescript
// Grant minting role and quota to each bank
const banks = [
  { pubkey: bankA, quota: new BN(40_000_000).mul(new BN(1_000_000)) }, // $40M
  { pubkey: bankB, quota: new BN(35_000_000).mul(new BN(1_000_000)) }, // $35M
  { pubkey: bankC, quota: new BN(25_000_000).mul(new BN(1_000_000)) }, // $25M
];

for (const bank of banks) {
  const [rolePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("role"), configPda.toBuffer(), Buffer.from([0]), bank.pubkey.toBuffer()],
    SSS_PROGRAM_ID
  );
  const [quotaPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("minter_quota"), configPda.toBuffer(), bank.pubkey.toBuffer()],
    SSS_PROGRAM_ID
  );

  // Grant Minter role
  await sssProgram.methods.updateRoles(0, true)
    .accounts({ config: configPda, roleAccount: rolePda, user: bank.pubkey,
                masterAuthority: consortiumAuthority.publicKey, systemProgram: SystemProgram.programId })
    .rpc();

  // Set quota
  await sssProgram.methods.updateMinter(bank.quota)
    .accounts({ config: configPda, minterQuota: quotaPda, minter: bank.pubkey,
                masterAuthority: consortiumAuthority.publicKey, systemProgram: SystemProgram.programId })
    .rpc();
}
```

---

## Reconciliation

### How `total_minted` Tracks Across All Issuers

The `StablecoinConfig.total_minted` field is incremented on every `mint_tokens` call, regardless of which member bank mints. This provides the consortium-level view:

```typescript
async function getConsortiumSupplyReport(sssProgram: Program, configPda: PublicKey) {
  const config = await sssProgram.account.stablecoinConfig.fetch(configPda);

  const banks = await getAllMinters(connection, configPda, SSS_PROGRAM_ID);
  const bankReports = await Promise.all(
    banks.map(async (bank) => {
      const [quotaPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("minter_quota"), configPda.toBuffer(), bank.toBuffer()],
        SSS_PROGRAM_ID
      );
      const quota = await sssProgram.account.minterQuota.fetch(quotaPda);
      return {
        bank: bank.toString(),
        quota: quota.quota.toString(),
        minted: quota.minted.toString(),
        utilization: quota.minted.mul(new BN(10000)).div(quota.quota).toNumber() / 100,
      };
    })
  );

  return {
    totalMinted: config.totalMinted.toString(),
    supplyCap: config.supplyCap.toString(),
    circulatingSupply: config.totalMinted.sub(config.totalBurned).toString(),
    banks: bankReports,
  };
}
```

### Quota Reallocation

When a bank's business grows, the consortium can reallocate quotas:

```typescript
// Bank A is growing — increase their quota by $10M
const [bankAQuotaPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("minter_quota"), configPda.toBuffer(), bankA.toBuffer()],
  SSS_PROGRAM_ID
);

const currentQuota = await sssProgram.account.minterQuota.fetch(bankAQuotaPda);
const newQuota = currentQuota.quota.add(new BN(10_000_000).mul(new BN(1_000_000)));

await sssProgram.methods.updateMinter(newQuota)
  .accounts({ config: configPda, minterQuota: bankAQuotaPda, minter: bankA,
              masterAuthority: consortiumAuthority.publicKey, systemProgram: SystemProgram.programId })
  .rpc();
```

### Monthly Quota Cycle

Consortium quotas typically reset monthly (matching reserve reporting cycles):

```typescript
// End of month: reset all bank minted counters
// This does NOT change the quota — it resets the running total
// so each bank can mint up to their full quota again next month
async function monthlyQuotaReset(banks: PublicKey[]) {
  const tx = new Transaction();
  for (const bank of banks) {
    const [quotaPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter_quota"), configPda.toBuffer(), bank.toBuffer()],
      SSS_PROGRAM_ID
    );
    tx.add(
      await sssProgram.methods.resetMinterQuota()
        .accounts({ config: configPda, minterQuota: quotaPda, minter: bank,
                    masterAuthority: consortiumAuthority.publicKey })
        .instruction()
    );
  }
  await provider.sendAndConfirm(tx, [consortiumAuthority]);
}
```

---

## Governance Model

### Consortium Board Decisions (Require Multisig)

- Supply cap adjustment (global ceiling)
- Quota reallocation between banks
- Adding/removing member banks
- Authority transfer

### Individual Bank Decisions (Self-managed)

- Day-to-day minting (within quota)
- Designating operational minting keys
- Pausing own operations (via Pauser role if granted)

### Dispute Resolution

If a bank mints beyond what their off-chain reserves justify (a protocol-level violation):

1. Consortium authority immediately revokes their Minter role: `update_roles(0, false)`
2. Their existing minted tokens remain in circulation
3. Consortium may use `seize` (if SSS-2 configured) to recover excess issuance
4. Quota is set to their actual `minted` value to lock further issuance

---

## Implementation Notes

### SSS-5 Does Not Require a New Program

All SSS-5 semantics are implemented using the existing SSS program. The "standard" is a configuration pattern, not a new program:

- Each member bank has a `MinterQuota` PDA
- The supply cap is the consortium aggregate limit
- The master authority is the consortium governance multisig
- Event indexing by `minter` field provides per-bank audit trails

### SSS-5 + SSS-2 (Compliance)

For regulated consortium stablecoins, add SSS-2 features:

- **Shared blacklist**: All banks share the same blacklist (one config, one transfer hook)
- **Shared allowlist**: Each transfer is checked against the same allowlist
- **Seizure**: The consortium authority holds the Seizer role for inter-bank recovery

### SSS-5 + SSS-Caps

Use the SSS-Caps module with separate `caps_authority` from `master_authority`:

```typescript
// Risk committee controls the caps; consortium board controls membership
await capsProgram.methods.initializeCapsConfig(
  consortiumSupplyCap,  // global cap = sum of all bank quotas
  perBankCap            // per-minter cap = largest single bank quota
).accounts({
  capsConfig: capsConfigPda,
  stablecoinConfig: stablecoinConfigPda,
  authority: riskCommittee.publicKey,  // Different from consortium board
}).rpc();
```

---

## On-Chain Verification

```typescript
// Verify consortium state on-chain
async function verifyConsortiumIntegrity(configPda: PublicKey) {
  const config = await sssProgram.account.stablecoinConfig.fetch(configPda);

  // Sum of all bank quotas should not exceed supply cap
  const totalQuota = bankReports.reduce((sum, b) => sum.add(new BN(b.quota)), new BN(0));
  if (config.supplyCap.gt(new BN(0))) {
    console.assert(totalQuota.lte(config.supplyCap), "Quotas exceed supply cap!");
  }

  // Sum of all bank minted should equal total_minted
  const sumMinted = bankReports.reduce((sum, b) => sum.add(new BN(b.minted)), new BN(0));
  console.assert(
    sumMinted.eq(config.totalMinted),
    `Minted sum mismatch: ${sumMinted} vs ${config.totalMinted}`
  );

  return { valid: true, totalQuota: totalQuota.toString() };
}
```

---

## Events

```rust
// SSS core events cover the fundamental operations.
// SSS-5 adds semantic clarity via the event indexer using the minter field.

// Per-bank issuance tracking via TokensMinted.minter field
// Filter events by minter = bankA.publicKey to get Bank A's history

// Quota reallocation events come from MinterQuotaUpdated
// Role grant/revoke events come from RoleUpdated
// Monthly reset events come from MinterQuotaReset
```

Recommended indexing strategy for consortium reporting:

```typescript
// Fetch all TokensMinted events for a specific bank
const events = await fetch(`${backendUrl}/api/v1/events?event_type=TokensMinted&limit=1000`);
const bankAEvents = events.filter(e => e.data.minter === bankA.toString());

// Aggregate bank A's total minted this period
const totalMinted = bankAEvents.reduce((sum, e) => sum + e.data.amount, 0);
console.log(`Bank A minted ${totalMinted} base units this period`);
```

---

## Consortium Compliance Architecture

For regulated multi-issuer stablecoins (e.g., under the GENIUS Act):

1. **Shared compliance layer**: All banks share the same SSS-2 blacklist. A sanction added by Bank A's compliance team blocks transfers for all banks' customers.

2. **Independent reporting**: Each bank submits its own reserve attestation for its allocated quota.

3. **Joint AML program**: The consortium operates a joint AML program. The `blacklisted_by` field records which institution's compliance officer added each blacklist entry.

4. **Audit segmentation**: The backend event indexer can filter `TokensMinted` events by `minter` to produce per-bank audit reports without changing any on-chain code.

5. **Interoperability**: Tokens minted by any bank are fully fungible. A holder cannot tell which bank issued their tokens, preserving the unified token model while maintaining separate issuer accountability.
