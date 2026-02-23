# Compliance Guide

## Overview

SSS-2 provides on-chain compliance primitives designed for regulated stablecoin issuers. This document covers the compliance features, their regulatory alignment, and operational best practices.

## Compliance Features

### Blacklist (Sanctions/AML)

The blacklist prevents blacklisted addresses from sending or receiving tokens. It is enforced at the protocol level via the SPL Transfer Hook.

**How it works:**
1. A Blacklister calls `add_to_blacklist` with an address and reason
2. A `BlacklistEntry` PDA is created at `["blacklist", config, address]`
3. On every `transfer_checked`, Token-2022 CPIs to the transfer hook program
4. The hook checks `BlacklistEntry` PDAs for both the source and destination owners
5. If either PDA exists and has data, the transfer is rejected

**BlacklistEntry fields:**
- `address` — the blacklisted public key
- `reason` — human-readable justification (max 64 characters)
- `blacklisted_at` — Unix timestamp of when the entry was created
- `blacklisted_by` — the Blacklister authority who created it

**Removal:**
- A Blacklister calls `remove_from_blacklist`
- The BlacklistEntry PDA is closed
- Rent is returned to the authority
- The address can transact again immediately

### Seize (Asset Recovery)

The seize function enables court-ordered or regulator-mandated asset recovery without the token holder's signature.

**How it works:**
1. A Seizer calls `seize` with the source token account, destination (treasury), and amount
2. The program verifies the Seizer role
3. The program CPIs `transfer_checked` using the config PDA as the permanent delegate
4. Tokens move from source to destination without the source owner's signature

**Requirements:**
- The stablecoin must have `enable_permanent_delegate: true` (SSS-2)
- The caller must have the Seizer role
- The destination is typically a treasury account controlled by the issuer

### Freeze/Thaw (Account-Level Controls)

Individual token accounts can be frozen to prevent all token movement.

**How it works:**
1. A Pauser calls `freeze` with the target token account
2. The program CPIs `freeze_account` via Token-2022
3. The account cannot send, receive, or burn tokens until thawed
4. A Pauser calls `thaw` to restore the account

### Pause/Unpause (Global Circuit Breaker)

All minting and burning can be halted globally.

**How it works:**
1. A Pauser calls `pause`
2. `config.paused` is set to `true`
3. All `mint` and `burn` instructions check this flag and reject if paused
4. Transfers are NOT affected by pause (they go through Token-2022 directly)
5. A Pauser calls `unpause` to resume

## Role Separation

SSS-2 enforces strict role separation. Each role is a separate PDA, and multiple entities can hold the same role type.

| Role | Type | Compliance Function |
|------|------|-------------------|
| Minter | 0 | Supply management |
| Burner | 1 | Redemption |
| Pauser | 2 | Emergency controls, account freezing |
| Blacklister | 3 | Sanctions/AML enforcement |
| Seizer | 4 | Court-ordered asset recovery |

**Best practices:**
- Assign different roles to different entities/multisigs
- Use multisig wallets (e.g., Squads) for sensitive roles
- Document role holders in your compliance records
- Regularly audit role assignments

## Audit Trail

All operations emit on-chain events that can be queried for compliance reporting:

| Event | Fields |
|-------|--------|
| `StablecoinInitialized` | config, name, symbol, decimals, authority, feature flags |
| `TokensMinted` | config, recipient, amount, minter, total_minted |
| `TokensBurned` | config, from, amount, burner, total_burned |
| `AccountFrozen` | config, token_account, authority |
| `AccountThawed` | config, token_account, authority |
| `StablecoinPaused` | config, authority |
| `StablecoinUnpaused` | config, authority |
| `RoleUpdated` | config, user, role_type, active, authority |
| `MinterUpdated` | config, minter, quota, authority |
| `AuthorityTransferred` | config, old_authority, new_authority |
| `AccountBlacklisted` | config, address, reason, authority |
| `AccountUnblacklisted` | config, address, authority |
| `TokensSeized` | config, from, to, amount, authority |

**Querying events:**

```typescript
import { AuditLog } from "@stbr/sss-compliance-sdk";

const audit = new AuditLog(connection, configAddress);

// Get all events
const events = await audit.getEvents();

// Filter by action type
const mints = await audit.getEvents({ action: "mint" });

// Filter by time range
const recent = await audit.getEvents({
  startTime: Math.floor(Date.now() / 1000) - 86400,
  endTime: Math.floor(Date.now() / 1000),
});
```

## Regulatory Alignment

### Sanctions Compliance

The blacklist feature addresses OFAC and similar sanctions requirements:
- Addresses on sanctions lists can be blocked from transacting
- The blacklist reason field provides an audit trail for why an address was blocked
- Removal is possible when sanctions are lifted or errors corrected

### Anti-Money Laundering (AML)

- Suspicious addresses identified through off-chain monitoring can be blacklisted
- Frozen accounts prevent movement while investigations proceed
- Seize enables recovery of illicitly obtained funds

### Court Orders

The seize function supports court-ordered asset recovery:
- A Seizer (typically the issuer's legal compliance team) can transfer tokens without the holder's consent
- The audit trail provides evidence for legal proceedings
- Role separation ensures only authorized entities can execute seizures

### GENIUS Act Alignment

SSS-2 is designed with the proposed GENIUS Act framework in mind:
- **Issuer controls**: Full authority over supply, roles, and compliance operations
- **Sanctions enforcement**: On-chain blacklist with transfer hook enforcement
- **Asset recovery**: Permanent delegate enables seizure capabilities
- **Transparency**: All operations emit events for audit and reporting
- **Interoperability**: Built on Token-2022 standards, compatible with the Solana ecosystem

## Feature Gating

SSS-2 compliance features are opt-in and cannot be added retroactively:

- `enable_transfer_hook` must be `true` at initialization for blacklist enforcement
- `enable_permanent_delegate` must be `true` at initialization for seize capability
- These flags are immutable after initialization
- SSS-2 instructions on SSS-1 configs return `ComplianceNotEnabled` error

This design ensures that:
1. Users know at mint creation time what capabilities the issuer has
2. Compliance features cannot be silently added later
3. SSS-1 stablecoins are guaranteed to never have blacklist/seize capability

## Operational Recommendations

1. **Document everything**: Keep off-chain records of blacklist reasons, seize orders, and role changes
2. **Use multisig**: All compliance roles should use multisig wallets
3. **Regular audits**: Periodically review role assignments and blacklist entries
4. **Incident response plan**: Document procedures for emergency freeze, blacklist, and seize
5. **Legal review**: Have legal counsel review compliance procedures before deployment
6. **Test thoroughly**: Use devnet to test all compliance operations before mainnet deployment
