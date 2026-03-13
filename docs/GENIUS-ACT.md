# GENIUS Act Compliance Mapping

## Overview of the GENIUS Act

The **Guiding and Establishing National Innovation for US Stablecoins (GENIUS) Act** is proposed U.S. federal legislation establishing a regulatory framework for "payment stablecoins" — digital assets designed to maintain a stable value relative to a fixed monetary amount, primarily the U.S. dollar.

The Act establishes:

1. **Permitted issuer classes**: National bank stablecoin issuers, federally-chartered nonbank stablecoin issuers, and state-qualified stablecoin issuers
2. **Reserve requirements**: 1:1 backing by high-quality liquid assets
3. **Redemption rights**: Holders must be able to redeem at par within a specified timeframe
4. **AML/KYC obligations**: Issuers must maintain Bank Secrecy Act (BSA) compliance programs
5. **Sanctions screening**: OFAC compliance required; banned entities cannot hold or transact
6. **Disclosure requirements**: Monthly attestation of reserve composition
7. **Operational requirements**: Business continuity, audit trails, incident reporting

> **Disclaimer**: This document reflects the legislative text as understood during drafting. The GENIUS Act's final form may differ. This is not legal advice — consult qualified legal counsel before deploying any regulated stablecoin.

---

## GENIUS Act Requirement Mapping

### Requirement 1: 1:1 Reserve Backing

**Statute**: Section 4 — Permissible Reserves. Payment stablecoins must be backed 1:1 by U.S. dollars, Treasury securities (≤2yr maturity), repos collateralized by Treasuries, FDIC-insured deposits, or central bank reserves.

**SSS Implementation:**

SSS enforces the on-chain side of reserve tracking through:

1. **Supply Cap**: `StablecoinConfig.supply_cap` prevents issuance beyond a specified ceiling, which the issuer sets to match their off-chain reserve balance.

```typescript
// Initialize with a supply cap matching your reserve
const reserveBalance = 10_000_000; // $10M in custody
await sssProgram.methods.initialize({
  // ...
  supplyCap: new BN(reserveBalance).mul(new BN(1_000_000)), // 6 decimals
}).rpc();
```

2. **Oracle Integration**: The SSS Oracle program can be configured to read a Switchboard V2 price feed that attests to reserve balances via an independent data provider. This provides cryptographic evidence that reported reserves match the price feed.

```typescript
// Link oracle to stablecoin for off-chain reserve attestation
await oracleProgram.methods.initializeOracle({
  aggregator: switchboardReserveFeed,
  baseCurrency: "USD",
  minPrice: new BN(980_000),  // $0.98
  maxPrice: new BN(1_020_000), // $1.02
  stalenessThreshold: new BN(3600), // 1 hour
  priceDecimals: 6,
  manualOverride: false,
}).rpc();
```

3. **Supply Transparency**: `get_supply_info` returns the on-chain circulating supply, which auditors can verify against off-chain reserve attestations.

**Gaps**: SSS does not hold reserves on-chain (they are fiat/Treasury securities in TradFi custody). The issuer is responsible for ensuring off-chain reserves equal the on-chain supply. SSS provides the enforcement mechanism; the attestation is the issuer's responsibility.

---

### Requirement 2: Redemption Rights

**Statute**: Section 6 — Redemption. Holders have the right to redeem at par ($1) within 2 business days. Issuers must maintain liquid reserves to fulfill redemption requests.

**SSS Implementation:**

The `burn_tokens` instruction is the on-chain redemption mechanism. When a holder submits a redemption request:

1. Holder calls `burn_tokens` (or initiates via the SSS-10 async queue)
2. Tokens are permanently destroyed
3. Off-chain: issuer sends equivalent fiat to the holder's bank account

**SSS-10 Async Redemption Queue** is purpose-built for the GENIUS Act's 2-business-day requirement:

```typescript
// User submits a redemption request
await sss10Program.methods.submitRedeemRequest(
  amount,
  "Redemption - bank ACH to account XXXXX" // memo for off-chain processing
).accounts({
  asyncConfig: asyncConfigPda,
  mintRequest: redeemRequestPda,
  sourceTokenAccount: userAta,
  requester: user.publicKey,
}).rpc();

// Emits RedeemRequested event with request_id and amount
// Off-chain: compliance team reviews, initiates ACH/wire
// Authority approves after off-chain settlement is confirmed
await sss10Program.methods.approveRedeemRequest(requestId).rpc();

// Execute burns the tokens on-chain
await sss10Program.methods.executeRedeemRequest(requestId).rpc();
// Emits RedeemExecuted event — permanent on-chain record
```

The `approved_by` field in `RedeemRequest` records which compliance officer approved the redemption, satisfying BSA record-keeping requirements.

---

### Requirement 3: AML/KYC Program

**Statute**: Section 8 — Bank Secrecy Act Compliance. Issuers must implement a written AML program including customer due diligence (CDD), beneficial ownership identification, and suspicious activity reporting (SAR).

**SSS Implementation:**

SSS does not perform KYC on-chain (identity documents cannot be stored on-chain efficiently). Instead, SSS provides the enforcement layer:

1. **Allowlist Module (Pre-screening)**: Using SSS-Allowlist in `AllowlistOnly` mode, only addresses that have passed off-chain KYC can receive minted tokens.

```typescript
// Add KYC-verified address after off-chain verification
await allowlistProgram.methods.addToAllowlist(
  "Customer ID: CUS-2026-00142 | KYC Verified: 2026-01-15 | Tier: Individual"
).accounts({
  allowlistConfig: allowlistConfigPda,
  allowlistEntry: entryPda,
  address: verifiedCustomer,
  authority: kycAuthority.publicKey,
}).rpc();
```

2. **Blacklist Module (Sanctions/AML screening)**: The SSS-2 blacklist is the primary sanctions enforcement mechanism. When an address is identified as a prohibited party, it is immediately blacklisted at the protocol level.

3. **Audit Trail**: Every compliance action (blacklist add/remove, allowlist add/remove, seizure) emits an event that is indexed by the backend API and surfaced via the `/api/v1/audit` endpoint in JSONL format suitable for BSA record-keeping.

```bash
# Export full audit trail as JSONL (suitable for FinCEN archival)
curl http://localhost:3001/api/v1/audit?format=jsonl \
  -H "x-api-key: $API_KEY" \
  > audit-$(date +%Y%m%d).jsonl
```

---

### Requirement 4: Sanctions Screening (OFAC Compliance)

**Statute**: Section 9 — Prohibited Transactions. Issuers must screen all participants against OFAC's Specially Designated Nationals (SDN) list and other prohibited parties lists.

**SSS Implementation:**

The Transfer Hook blacklist is the strongest technical enforcement available on Solana:

1. **Real-time enforcement**: Every token transfer — regardless of which application initiates it — is intercepted by the Transfer Hook. Blacklisted addresses cannot send or receive tokens.

2. **Immediate effect**: Adding an address to the blacklist takes effect in the same slot. There is no delay.

3. **Cannot be bypassed by users**: The hook is enforced at the Token-2022 protocol level. A blacklisted user cannot call a different program to move their tokens.

**Recommended OFAC Screening Architecture**:

```
External SDN Feed (OFAC API / TRM Labs / Chainalysis)
         │
         ▼
    Backend Screener
    (monitors new addresses)
         │
         ▼
    Compliance Review
    (human approval for SDN matches)
         │
         ▼
    add_to_blacklist()
    (on-chain enforcement)
         │
         ▼
    Transfer Hook blocks all transfers
    (cryptographic enforcement)
```

```typescript
// Automated OFAC screening workflow
async function screenAndBlacklist(address: PublicKey, ssnListMatch: OFACMatch) {
  // Log the screening action
  await auditLog.record({
    action: "ofac_screen",
    address: address.toString(),
    match: ssnListMatch,
    screener: autoScreener.publicKey.toString(),
    timestamp: new Date().toISOString(),
  });

  if (ssnListMatch.certainty === "confirmed") {
    // Automatic blacklisting for confirmed SDN matches
    await sssProgram.methods
      .addToBlacklist(`OFAC SDN: ${ssnListMatch.listEntry} | Certainty: ${ssnListMatch.certainty}`)
      .accounts({ /* ... */ })
      .rpc();
  } else {
    // Queue for human review for probable matches
    await complianceQueue.enqueue({ address, match: ssnListMatch });
  }
}
```

---

### Requirement 5: Issuer Control and Governance

**Statute**: Section 3 — Permitted Payment Stablecoin Issuers. Issuers must be licensed entities; governance must meet prudential standards.

**SSS Implementation:**

1. **Master Authority**: The `StablecoinConfig.master_authority` is the on-chain governance principal. For GENIUS Act compliance, this should be a Squads multisig controlled by the licensed issuer.

2. **Role Segregation**: SSS enforces role separation between minting, burning, pausing, blacklisting, and seizing. No single key can perform all operations.

3. **2-Step Authority Transfer**: Authority transfers require a proposal and acceptance, preventing accidental or unauthorized governance changes.

4. **Timelock on Parameter Changes**: Using the SSS-Timelock module, cap increases and role grants can be subject to a mandatory delay, giving the board of directors visibility before changes take effect.

**Recommended Governance Structure for GENIUS Act:**

| Role | Held By | Description |
|------|---------|-------------|
| Master Authority | 3-of-5 board multisig | Cap updates, role grants, authority transfer |
| Minter | Treasury team (2-of-3) | Day-to-day issuance |
| Burner | Treasury team (2-of-3) | Redemption processing |
| Pauser | Compliance team (1-of-2) | Emergency circuit breaker |
| Blacklister | Compliance team (1-of-2) | Sanctions enforcement |
| Seizer | Legal team (requires board approval) | Court-ordered recovery |

---

### Requirement 6: Reserve Reporting

**Statute**: Section 7 — Disclosure Requirements. Issuers must publish monthly attestations of reserve composition, including asset type, custodian, and maturity.

**SSS Implementation:**

The `get_supply_info` view instruction returns the on-chain circulating supply at any block height. Combined with off-chain reserve attestations, issuers can publish monthly reports.

```typescript
// Fetch current supply state
const config = await sssProgram.account.stablecoinConfig.fetch(configPda);
const totalMinted = config.totalMinted.toString();
const totalBurned = config.totalBurned.toString();
const circulatingSupply = config.totalMinted.sub(config.totalBurned).toString();
const supplyCap = config.supplyCap.toString();

// Generate reserve report
const report = {
  reportDate: new Date().toISOString(),
  circulatingSupply,
  totalMinted,
  totalBurned,
  supplyCap,
  // Off-chain fields (issuer fills these from their custodian)
  reserveComposition: {
    usdCash: "5000000.00",
    usTreasuries: "4950000.00",
    tbillMaturity: "2026-06-30",
    custodian: "First National Bank",
    attestedBy: "Ernst & Young LLP",
    attestationDate: new Date().toISOString(),
  },
};
```

The backend API's event indexer provides a complete transaction history that can be used to reconcile the circulating supply against reserve movements.

---

## Recommended Architecture for Full GENIUS Act Compliance

```
┌──────────────────────────────────────────────────────────────┐
│                    Governance Layer                          │
│                                                              │
│   Board Multisig (Squads 3-of-5)                            │
│   ├── SSS Master Authority                                  │
│   └── Timelock: 48hr delay on all parameter changes        │
└──────────────────────────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────────────┐
│                   Issuance Controls                          │
│                                                              │
│   SSS-Allowlist (AllowlistOnly mode)                        │
│   └── KYC-Verified addresses only can hold tokens          │
│                                                              │
│   SSS-Caps (Risk team authority)                            │
│   └── Global cap = custodied reserve balance               │
│                                                              │
│   SSS-10 Async Mint/Redeem                                  │
│   └── Every issuance and redemption requires approval      │
└──────────────────────────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────────────┐
│                  Compliance Controls                         │
│                                                              │
│   SSS-2 Blacklist (Transfer Hook)                           │
│   ├── OFAC SDN list enforcement                             │
│   └── Real-time screening integration                       │
│                                                              │
│   SSS-2 Seize (Permanent Delegate)                          │
│   └── Court-ordered asset recovery                         │
│                                                              │
│   SSS-2 Freeze/Pause                                        │
│   └── Emergency circuit breakers                           │
└──────────────────────────────────────────────────────────────┘
                         │
┌──────────────────────────────────────────────────────────────┐
│                   Audit & Reporting                          │
│                                                              │
│   Backend Event Indexer                                     │
│   ├── All events indexed with timestamps                   │
│   ├── JSONL export for FinCEN record-keeping               │
│   └── Webhook notifications for real-time monitoring       │
│                                                              │
│   Oracle Program                                            │
│   └── Price feed attestation linked to supply cap          │
└──────────────────────────────────────────────────────────────┘
```

---

## Limitations and Gaps

### What SSS Does Not Provide

| Requirement | Status | Notes |
|-------------|--------|-------|
| KYC identity verification | Off-chain | SSS enforces the allowlist; identity verification must happen off-chain |
| Reserve custody | Off-chain | Reserves must be held in regulated TradFi accounts |
| SAR filing | Off-chain | SSS provides the audit trail; actual FinCEN filings are the issuer's responsibility |
| Redemption SLA enforcement | Partial | SSS-10 provides the queue and record-keeping; the 2-business-day window is an operational commitment |
| Cross-chain compliance | Not covered | If the stablecoin bridges to other chains, those chains need their own compliance stack |
| Travel Rule (FATF) | Not covered | Sender/receiver identity disclosure for transfers >$3,000 must be implemented at the application layer |

### Architecture Considerations

1. **Oracle independence**: The supply cap / oracle pairing is not cryptographically binding. An issuer can increase the cap without increasing reserves. This must be governed by the board multisig.

2. **Blacklist latency**: There is a block latency between when an OFAC match is discovered and when the blacklist takes effect. A screener that runs before every transaction (application-level check) should be implemented as a first line of defense.

3. **Permanent delegate risk**: The `seize` capability is powerful. Its use should require multi-sig approval and legal justification documentation stored in the memo field.

4. **Key compromise**: If the master authority keypair is compromised, an attacker could grant themselves unlimited minting rights. The Squads multisig requirement mitigates this.
