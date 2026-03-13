# SSS-10: Async Mint/Redeem (CBDC-Style)

| Field | Value |
|-------|-------|
| Standard | SSS-10 |
| Title | Asynchronous Mint and Redeem with Approval Queue |
| Status | Final |
| Program | `sss-10` |
| Program Seeds | `async_config`, `mint_request`, `redeem_request` |

---

## Abstract

SSS-10 implements a regulated issuance model where every mint and redemption request requires explicit approval from a designated authority before tokens are created or destroyed. This is the architecture appropriate for Central Bank Digital Currencies (CBDCs), regulated e-money tokens under the EU MiCA regime, or any stablecoin where the issuer must approve individual issuance events.

---

## Motivation

Many regulated stablecoin frameworks require that issuance is not automatic. Examples:

- **CBDC design**: Central banks want to approve every issuance event, possibly after AML/KYC screening
- **E-money directive (EU)**: E-money institutions must be able to review and approve redemption requests
- **GENIUS Act Tier 1 issuers**: Bank-issued stablecoins may require internal approval workflows for large mints
- **Institutional onboarding**: A new institutional client requests their first $10M mint; compliance must sign off before tokens are issued

SSS-10 provides the on-chain queue and status machine for this workflow. Off-chain systems (compliance databases, AML screening, human review) connect via the backend API and webhooks.

---

## On-Chain Programs

SSS-10 is implemented as the `sss-10` Anchor program. It wraps the main SSS program: the `AsyncConfig` holds a Minter role and quota in SSS, and executes minting via CPI after approval.

---

## Account Layout

### AsyncConfig

**Seeds**: `["async_config", stablecoin_config]`

```rust
#[account]
pub struct AsyncConfig {
    /// The SSS StablecoinConfig PDA this async layer wraps
    pub stablecoin_config: Pubkey,
    /// Who can approve or reject requests
    pub authority: Pubkey,
    /// The Token-2022 mint address
    pub mint: Pubkey,
    /// Monotonically increasing counter; used as seed for request PDAs
    pub total_requests: u64,
    /// PDA bump seed
    pub bump: u8,
}
```

### RequestStatus

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq)]
pub enum RequestStatus {
    Pending   = 0,
    Approved  = 1,
    Rejected  = 2,
    Executed  = 3,
    Cancelled = 4,
}
```

### MintRequest

**Seeds**: `["mint_request", async_config, request_id_le_bytes]`

```rust
#[account]
pub struct MintRequest {
    pub async_config: Pubkey,
    pub request_id: u64,
    pub requester: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub status: RequestStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub approved_by: Pubkey,  // Pubkey::default() until approved
    pub memo: String,         // max 128 chars
    pub bump: u8,
}
```

### RedeemRequest

**Seeds**: `["redeem_request", async_config, request_id_le_bytes]`

```rust
#[account]
pub struct RedeemRequest {
    pub async_config: Pubkey,
    pub request_id: u64,
    pub requester: Pubkey,
    pub source_token_account: Pubkey,
    pub amount: u64,
    pub status: RequestStatus,
    pub created_at: i64,
    pub updated_at: i64,
    pub approved_by: Pubkey,
    pub memo: String,
    pub bump: u8,
}
```

---

## Status Lifecycle

```
                    ┌─────────────┐
                    │   Pending   │◄───── Created by requester
                    └──────┬──────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
      ┌─────────┐    ┌──────────┐    ┌───────────┐
      │Approved │    │ Rejected │    │ Cancelled │
      └────┬────┘    └──────────┘    └───────────┘
           │         (terminal)       (by requester
           ▼                          while Pending)
      ┌──────────┐
      │ Executed │ ◄── Actual mint/burn happens here
      └──────────┘
      (terminal)
```

### Valid Transitions

| From | To | Who Can Trigger |
|------|----|----------------|
| Pending | Approved | `async_config.authority` |
| Pending | Rejected | `async_config.authority` |
| Pending | Cancelled | Original `requester` |
| Approved | Executed | Anyone (permissionless execution after approval) |

Once a request is `Executed`, `Rejected`, or `Cancelled`, it cannot transition further. The PDA remains on-chain as a permanent audit record.

---

## Instructions

### `initialize_async_config`

Creates the `AsyncConfig` PDA. The authority should hold a Minter role in the SSS program.

```typescript
const [asyncConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("async_config"), stablecoinConfigPda.toBuffer()],
  SSS_10_PROGRAM_ID
);

await sss10Program.methods.initializeAsyncConfig()
  .accounts({
    asyncConfig: asyncConfigPda,
    stablecoinConfig: stablecoinConfigPda,
    mint: mintAddress,
    authority: complianceTeam.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### `submit_mint_request`

Creates a `MintRequest` in `Pending` status. Anyone can submit.

```typescript
const requestId = 0n; // Derived from asyncConfig.total_requests

const reqIdBuf = Buffer.alloc(8);
reqIdBuf.writeBigUInt64LE(requestId);
const [mintRequestPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("mint_request"), asyncConfigPda.toBuffer(), reqIdBuf],
  SSS_10_PROGRAM_ID
);

await sss10Program.methods.submitMintRequest(
  new BN(10_000_000_000), // 10,000 tokens (6 decimals)
  "Institutional onboarding: Client ID CUS-2026-00187"
).accounts({
  asyncConfig: asyncConfigPda,
  mintRequest: mintRequestPda,
  recipient: clientAta,
  requester: requester.publicKey,
  clock: SYSVAR_CLOCK_PUBKEY,
  systemProgram: SystemProgram.programId,
}).rpc();
// Emits MintRequested { async_config, request_id, requester, recipient, amount }
```

### `approve_mint_request`

Authority approves the request. Records `approved_by`.

```typescript
await sss10Program.methods.approveMintRequest(new BN(requestId))
  .accounts({
    asyncConfig: asyncConfigPda,
    mintRequest: mintRequestPda,
    authority: complianceTeam.publicKey,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
// Emits MintApproved { request_id, approved_by }
```

### `reject_mint_request`

Authority rejects. No tokens are minted. Request is terminal.

```typescript
await sss10Program.methods.rejectMintRequest(new BN(requestId))
  .accounts({
    asyncConfig: asyncConfigPda,
    mintRequest: mintRequestPda,
    authority: complianceTeam.publicKey,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
// Emits MintRejected { request_id, rejected_by }
```

### `execute_mint_request`

Permissionless. Anyone can call after a request is `Approved`. CPIs into SSS to mint tokens.

```typescript
await sss10Program.methods.executeMintRequest(new BN(requestId))
  .accounts({
    asyncConfig: asyncConfigPda,
    mintRequest: mintRequestPda,
    // SSS accounts for the CPI:
    stablecoinConfig: stablecoinConfigPda,
    minterQuota: asyncProgramMinterQuotaPda,
    roleAccount: asyncProgramMinterRolePda,
    recipientTokenAccount: clientAta,
    mint: mintAddress,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    sssProgram: SSS_PROGRAM_ID,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
// Emits MintExecuted { request_id, amount }
// SSS also emits TokensMinted
```

### `cancel_mint_request`

The original requester can cancel a `Pending` request. No tokens are minted.

```typescript
await sss10Program.methods.cancelMintRequest(new BN(requestId))
  .accounts({
    asyncConfig: asyncConfigPda,
    mintRequest: mintRequestPda,
    requester: requester.publicKey,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
// Emits MintCancelled { request_id, cancelled_by }
```

### Redeem Instructions

Mirror the mint instructions:
- `submit_redeem_request` — requester creates a redeem request
- `approve_redeem_request` — authority approves
- `execute_redeem_request` — anyone executes; CPIs into SSS to burn tokens

---

## TypeScript SDK Examples

### Submit and Poll a Request

```typescript
async function mintWithApproval(
  program: Program,
  asyncConfigPda: PublicKey,
  recipient: PublicKey,
  amount: BN,
  memo: string
): Promise<{ requestId: BN; signature: string }> {
  // Get current request count to derive PDA
  const config = await program.account.asyncConfig.fetch(asyncConfigPda);
  const requestId = config.totalRequests;

  const reqIdBuf = Buffer.alloc(8);
  reqIdBuf.writeBigUInt64LE(BigInt(requestId.toNumber()));
  const [mintRequestPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_request"), asyncConfigPda.toBuffer(), reqIdBuf],
    program.programId
  );

  const sig = await program.methods
    .submitMintRequest(amount, memo)
    .accounts({
      asyncConfig: asyncConfigPda,
      mintRequest: mintRequestPda,
      recipient,
      requester: program.provider.publicKey,
      clock: SYSVAR_CLOCK_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });

  return { requestId, signature: sig };
}

// Poll until request is executed or rejected
async function waitForApproval(
  program: Program,
  mintRequestPda: PublicKey,
  timeoutMs = 5 * 60 * 1000 // 5 minutes
): Promise<RequestStatus> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const request = await program.account.mintRequest.fetch(mintRequestPda);

    if (request.status !== RequestStatus.Pending) {
      return request.status;
    }

    await new Promise(resolve => setTimeout(resolve, 5000)); // Poll every 5s
  }

  throw new Error("Request approval timed out");
}
```

### Compliance Dashboard: List Pending Requests

```typescript
async function listPendingRequests(
  program: Program,
  asyncConfigPda: PublicKey
): Promise<MintRequest[]> {
  const config = await program.account.asyncConfig.fetch(asyncConfigPda);
  const total = config.totalRequests.toNumber();

  const requests: MintRequest[] = [];

  for (let i = 0; i < total; i++) {
    const reqIdBuf = Buffer.alloc(8);
    reqIdBuf.writeBigUInt64LE(BigInt(i));
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("mint_request"), asyncConfigPda.toBuffer(), reqIdBuf],
      program.programId
    );

    try {
      const req = await program.account.mintRequest.fetch(pda);
      if (req.status === RequestStatus.Pending) {
        requests.push(req);
      }
    } catch {
      continue; // PDA may not exist if sequence was skipped (shouldn't happen)
    }
  }

  return requests;
}
```

---

## Integration with AML Screening

The `approved_by` field records which compliance officer (or automated screener) approved the request. This satisfies BSA record-keeping requirements:

```typescript
// Automated AML screening flow
async function screenAndApprove(
  mintRequestPda: PublicKey,
  requester: PublicKey,
  amount: BN
): Promise<boolean> {
  // Off-chain: screen the requester
  const screenResult = await amlService.screen(requester.toString(), amount.toNumber());

  if (screenResult.status === "clear") {
    // Auto-approve
    await sss10Program.methods.approveMintRequest(requestId)
      .accounts({
        asyncConfig: asyncConfigPda,
        mintRequest: mintRequestPda,
        authority: automatedScreener.publicKey, // Screener's keypair
      })
      .rpc();

    return true;
  } else {
    // Queue for human review or auto-reject
    if (screenResult.status === "confirmed_match") {
      await sss10Program.methods.rejectMintRequest(requestId).rpc();
    } else {
      await humanReviewQueue.add({ mintRequestPda, screenResult });
    }
    return false;
  }
}
```

---

## Timeout and Auto-Rejection

SSS-10 does not implement on-chain auto-rejection on timeout (which would require a time-based crank). Instead, the recommended pattern is an off-chain cron job:

```typescript
// Run every hour: reject stale pending requests
async function rejectStalePendingRequests(
  program: Program,
  asyncConfigPda: PublicKey,
  maxAgeSeconds: number = 48 * 60 * 60 // 48 hours
) {
  const now = Math.floor(Date.now() / 1000);
  const pending = await listPendingRequests(program, asyncConfigPda);

  for (const req of pending) {
    if (now - req.createdAt.toNumber() > maxAgeSeconds) {
      console.log(`Auto-rejecting stale request ${req.requestId.toString()}`);
      await program.methods.rejectMintRequest(req.requestId)
        .accounts({
          asyncConfig: asyncConfigPda,
          mintRequest: /* derive PDA */,
          authority: complianceTeam.publicKey,
        })
        .rpc();
    }
  }
}
```

---

## GENIUS Act Alignment

SSS-10 is specifically designed to support GENIUS Act compliance requirements:

| Requirement | SSS-10 Mechanism |
|-------------|-----------------|
| Individual issuance approval | `approved_by` field — every mint records the approving authority |
| Redemption processing | `RedeemRequest` queue with `approved_by` recorder |
| AML screening before issuance | Approval workflow integrates with off-chain AML services |
| Audit trail | Every state transition emits an event; events are indexed by the backend |
| 2-business-day redemption | `RedeemRequest` status machine tracks the pipeline |
| Record retention | Request PDAs are permanent on-chain records |
