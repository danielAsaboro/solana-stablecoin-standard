# SSS-9: Governance-Controlled Stablecoin

| Field | Value |
|-------|-------|
| Standard | SSS-9 |
| Title | DAO Governance-Gated Stablecoin |
| Status | Draft |
| Requires | SSS-1 |
| Use Case | DAO treasury token, community-governed stablecoin, on-chain democratic supply management |

---

## Abstract

SSS-9 wraps SSS-1 with an on-chain governance layer. All major state changes — including minting, supply cap adjustments, role changes, and parameter updates — require a passed governance proposal. Token holders vote using a designated governance token, and the proposal outcome is executed directly on-chain via CPI into the SSS program.

---

## Use Cases

1. **DAO treasury stablecoin**: A DAO issues stablecoins backed by its treasury. The DAO votes on any new issuance.

2. **Community reserve currency**: An on-chain community issues a stablecoin as an internal currency. All parameter changes require community consensus.

3. **Delegated governance**: A foundation controls the governance token; token holders can delegate votes without surrendering custody.

---

## Architecture

```
GovernanceConfig PDA
["governance_config", stablecoin_config]
  ├── governance_token_mint: Pubkey
  ├── quorum_bps: u32 (min % of total supply to vote, e.g., 1000 = 10%)
  ├── approval_threshold_bps: u32 (% of cast votes to approve, e.g., 5100 = 51%)
  ├── voting_period_seconds: u64 (e.g., 259200 = 3 days)
  ├── timelock_delay_seconds: u64 (delay after passing before execution)
  └── authority: Pubkey (multisig for emergency actions)

Proposal PDA
["proposal", governance_config, proposal_id_le]
  ├── id: u64
  ├── proposer: Pubkey
  ├── title: String
  ├── description: String
  ├── action: ProposalAction (enum)
  ├── status: ProposalStatus
  ├── created_at: i64
  ├── voting_ends_at: i64
  ├── executable_after: i64 (created_at + voting_period + timelock_delay)
  ├── votes_for: u64
  ├── votes_against: u64
  └── total_supply_at_snapshot: u64

VoteRecord PDA
["vote_record", proposal, voter]
  ├── proposal: Pubkey
  ├── voter: Pubkey
  ├── vote_weight: u64
  ├── vote_for: bool
  └── voted_at: i64
```

---

## ProposalAction Enum

```rust
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum ProposalAction {
    /// Mint stablecoins to a specific recipient
    MintTokens {
        recipient: Pubkey,
        amount: u64,
        reason: String,
    },
    /// Update the global supply cap
    UpdateSupplyCap {
        new_cap: u64,
    },
    /// Grant or revoke a role
    UpdateRole {
        user: Pubkey,
        role_type: u8,
        active: bool,
    },
    /// Update a minter's quota
    UpdateMinterQuota {
        minter: Pubkey,
        new_quota: u64,
    },
    /// Pause the stablecoin
    Pause,
    /// Unpause the stablecoin
    Unpause,
    /// Update governance parameters
    UpdateGovernanceParams {
        quorum_bps: Option<u32>,
        approval_threshold_bps: Option<u32>,
        voting_period_seconds: Option<u64>,
    },
}
```

---

## Governance Lifecycle

```
1. PROPOSE       → GovernanceStatus::Active
   Proposer creates a Proposal PDA with the intended action.
   Voting period begins.

2. VOTE          → (ongoing during voting period)
   Token holders cast votes by locking governance tokens.
   One token = one vote.
   Each voter creates a VoteRecord PDA.

3. CLOSE VOTING  → GovernanceStatus::Passed | Rejected
   After voting_ends_at, anyone can close the voting.
   If votes_for / (votes_for + votes_against) >= approval_threshold_bps
   AND votes_for + votes_against >= quorum_bps * total_supply / 10000:
     Status = Passed
   Else:
     Status = Rejected

4. EXECUTE       → GovernanceStatus::Executed
   After executable_after (timelock), anyone can call execute_proposal.
   The proposal CPI's into SSS to perform the action.

5. CANCEL        → GovernanceStatus::Cancelled
   The authority can cancel at any point before execution.
```

---

## Instructions

### `initialize_governance_config`

```typescript
await sss9Program.methods.initializeGovernanceConfig({
  governanceTokenMint: govTokenMint,
  quorumBps: 1000,                // 10% of total supply must vote
  approvalThresholdBps: 5100,     // 51% approval to pass
  votingPeriodSeconds: new BN(259200), // 3 days
  timelockDelaySeconds: new BN(86400), // 1 day delay after passing
}).accounts({
  governanceConfig: governanceConfigPda,
  stablecoinConfig: sssConfigPda,
  authority: founders.publicKey,
  systemProgram: SystemProgram.programId,
}).rpc();
```

### `create_proposal`

```typescript
const proposalId = await sss9Program.methods.createProposal({
  title: "Mint 50,000 GDAO to Dev Fund",
  description: "Quarterly developer grant allocation per DAO vote #47.",
  action: {
    mintTokens: {
      recipient: devFundAta,
      amount: new BN(50_000).mul(new BN(1_000_000)),
      reason: "Q1 2026 developer grants",
    }
  }
}).accounts({
  governanceConfig: governanceConfigPda,
  proposal: proposalPda,
  proposer: proposer.publicKey,
  clock: SYSVAR_CLOCK_PUBKEY,
  systemProgram: SystemProgram.programId,
}).rpc();
```

### `cast_vote`

```typescript
await sss9Program.methods.castVote(true) // true = vote for
  .accounts({
    proposal: proposalPda,
    voteRecord: voteRecordPda,
    voterGovernanceTokenAccount: voterGovAta,
    voter: voter.publicKey,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
```

Votes are weighted by the voter's governance token balance at the time of voting. The governance token is NOT locked (no escrow) — this is a tradeoff for simplicity; a production system should use a snapshot or lockup mechanism.

### `close_voting`

```typescript
// After voting_ends_at, close the voting to determine outcome
await sss9Program.methods.closeVoting(proposalId)
  .accounts({
    proposal: proposalPda,
    governanceConfig: governanceConfigPda,
    governanceTokenMint: govTokenMint,
    clock: SYSVAR_CLOCK_PUBKEY,
  })
  .rpc();
```

### `execute_proposal`

```typescript
// After timelock expires, execute the passed proposal
await sss9Program.methods.executeProposal(proposalId)
  .accounts({
    proposal: proposalPda,
    governanceConfig: governanceConfigPda,
    stablecoinConfig: sssConfigPda,
    // Action-specific accounts passed via remaining_accounts
    // For mintTokens: mint, minterQuota, roleAccount, recipientAta, ...
    clock: SYSVAR_CLOCK_PUBKEY,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
    sssProgramId: SSS_PROGRAM_ID,
  })
  .remainingAccounts(buildActionAccounts(proposal.action))
  .rpc();
```

---

## Integration with Realms (SPL Governance)

Instead of building a custom governance system, SSS-9 can integrate with [Realms](https://app.realms.today), the SPL Governance standard:

```typescript
import { withCreateProposal, withCastVote } from "@solana/spl-governance";

// Create a Realms proposal that, when executed, calls SSS update_supply_cap
const proposalAddress = await withCreateProposal(
  instructions,
  SPL_GOVERNANCE_PROGRAM_ID,
  realmPubkey,
  governancePubkey,
  tokenOwnerRecord,
  "Increase supply cap to $50M",
  "Required to support Q1 institutional demand",
  governingTokenMint,
  governanceAuthority,
  0, // proposal index
  VoteType.SINGLE_CHOICE,
  ["Approve"],
  true, // useDenyOption
  proposer,
  undefined
);

// The proposal executes:
// update_supply_cap CPI → SSS program
```

This approach leverages Realms' existing voting infrastructure, delegation mechanisms, and compatibility with governance dashboards like Realms.today.

---

## Gated Minting Flow

In SSS-9, the governance program holds the `MinterRole` PDA and `MinterQuota` for the SSS program. Individual token holders cannot mint directly — only governance proposals can trigger minting:

```
Token Holder → create_proposal(MintTokens { ... })
  → DAO Votes → Proposal Passes → Timelock Delay
  → execute_proposal() → CPI: SSS.mint_tokens()
  → Tokens minted to specified recipient
```

This means the total issuance is determined by democratic vote, not by a single authority.

---

## Emergency Powers

The `authority` (typically a small emergency multisig of core contributors) retains the ability to:

1. **Cancel a proposal** before execution if a critical bug is discovered
2. **Pause the stablecoin** via the Pauser role without a governance vote (emergencies only)
3. **Execute time-sensitive actions** with a shortened or bypassed timelock in defined emergency conditions (e.g., oracle failure, critical exploit)

These powers are limited and should be constrained by:

```typescript
// The authority is a 4-of-7 Squads multisig of known contributors
// Emergency actions are publicly visible on-chain
// The DAO can revoke the authority via governance vote
```

---

## Events

```rust
#[event]
pub struct ProposalCreated {
    pub governance_config: Pubkey,
    pub proposal_id: u64,
    pub proposer: Pubkey,
    pub title: String,
    pub voting_ends_at: i64,
    pub executable_after: i64,
}

#[event]
pub struct VoteCast {
    pub proposal: Pubkey,
    pub voter: Pubkey,
    pub vote_weight: u64,
    pub vote_for: bool,
    pub cumulative_for: u64,
    pub cumulative_against: u64,
}

#[event]
pub struct ProposalFinalized {
    pub proposal: Pubkey,
    pub status: ProposalStatus, // Passed | Rejected
    pub votes_for: u64,
    pub votes_against: u64,
    pub quorum_reached: bool,
}

#[event]
pub struct ProposalExecuted {
    pub proposal: Pubkey,
    pub executor: Pubkey,
    pub executed_at: i64,
}
```
