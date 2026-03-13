# Events Reference

Every state-changing instruction in SSS emits exactly one Anchor event. Events are written to the Solana transaction log as base64-encoded Borsh-serialized data prefixed with `"Program data: "`. Off-chain indexers, the backend API, and the TypeScript SDK parse these logs to build audit trails, trigger webhooks, and drive UI updates.

---

## Subscribing to Events

### TypeScript — `program.addEventListener`

```typescript
import { Program } from "@coral-xyz/anchor";
import { Sss } from "../target/types/sss";

const program = new Program<Sss>(idl, SSS_PROGRAM_ID, provider);

// Subscribe to a specific event type
const listenerId = program.addEventListener("TokensMinted", (event, slot, sig) => {
  console.log("Minted:", event.amount.toString(), "to", event.recipient.toString());
  console.log("Slot:", slot, "Tx:", sig);
});

// Unsubscribe when done
await program.removeEventListener(listenerId);
```

### TypeScript — Parsing from Transaction Logs

```typescript
import { BorshCoder, EventParser } from "@coral-xyz/anchor";

const parser = new EventParser(SSS_PROGRAM_ID, new BorshCoder(idl));
const tx = await connection.getTransaction(signature, {
  commitment: "confirmed",
  maxSupportedTransactionVersion: 0,
});

if (tx?.meta?.logMessages) {
  for (const event of parser.parseLogs(tx.meta.logMessages)) {
    console.log(event.name, event.data);
  }
}
```

### Backend Polling (REST API)

```bash
# Poll indexed events via the backend
curl http://localhost:3001/api/v1/events?event_type=TokensMinted&limit=10 \
  -H "x-api-key: $API_KEY"
```

---

## Borsh Encoding Layout

Anchor encodes events as:
1. 8-byte SHA256 discriminator (first 8 bytes of `sha256("event:<EventName>")`)
2. Borsh-serialized struct fields in declaration order

Each `Pubkey` is 32 bytes. `String` is 4-byte little-endian length prefix followed by UTF-8 bytes. `u64` is 8-byte little-endian. `u8` is 1 byte. `bool` is 1 byte (0 or 1). `i64` is 8-byte little-endian signed.

---

## SSS Core Program Events

### `StablecoinInitialized`

Emitted by: `initialize`

Signals that a new stablecoin mint and config PDA have been created on-chain.

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The newly created `StablecoinConfig` PDA address |
| `mint` | `Pubkey` | The Token-2022 mint address |
| `authority` | `Pubkey` | The master authority who initialized the stablecoin |
| `name` | `String` | Human-readable stablecoin name (max 32 chars) |
| `symbol` | `String` | Token ticker symbol (max 10 chars) |
| `decimals` | `u8` | Number of decimal places (0–9) |
| `enable_permanent_delegate` | `bool` | Whether the permanent delegate extension is active (SSS-2) |
| `enable_transfer_hook` | `bool` | Whether the transfer hook extension is active (SSS-2) |
| `enable_confidential_transfer` | `bool` | Whether confidential transfers are active (SSS-3) |

Example:
```json
{
  "name": "StablecoinInitialized",
  "data": {
    "config": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
    "mint": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "authority": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
    "name": "My USD",
    "symbol": "MUSD",
    "decimals": 6,
    "enablePermanentDelegate": false,
    "enableTransferHook": false,
    "enableConfidentialTransfer": false
  }
}
```

---

### `TokensMinted`

Emitted by: `mint_tokens`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `minter` | `Pubkey` | The minter who executed this operation |
| `recipient` | `Pubkey` | The recipient token account that received the tokens |
| `amount` | `u64` | Number of tokens minted in base units |
| `minter_total_minted` | `u64` | The minter's cumulative minted total after this operation |

Note: `minter_total_minted` reflects the running total in the `MinterQuota` PDA. It never decreases (even when the quota is reset via `reset_minter_quota`). Use `minter_total_minted` for audit purposes.

Example:
```json
{
  "name": "TokensMinted",
  "data": {
    "config": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
    "minter": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
    "recipient": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    "amount": 1000000,
    "minterTotalMinted": 5000000
  }
}
```

---

### `TokensBurned`

Emitted by: `burn_tokens`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `burner` | `Pubkey` | The burner who executed this operation |
| `from` | `Pubkey` | The token account from which tokens were burned |
| `amount` | `u64` | Number of tokens burned in base units |

Example:
```json
{
  "name": "TokensBurned",
  "data": {
    "config": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
    "burner": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG",
    "from": "7Mn2kL3pQFkHhgx3nL9mVqRsJkYtBnXdWpHcGfZeKuAmPs",
    "amount": 500000
  }
}
```

---

### `AccountFrozen`

Emitted by: `freeze_token_account`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `authority` | `Pubkey` | The Pauser who froze the account |
| `account` | `Pubkey` | The token account that was frozen |

---

### `AccountThawed`

Emitted by: `thaw_token_account`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `authority` | `Pubkey` | The Pauser who thawed the account |
| `account` | `Pubkey` | The token account that was thawed |

---

### `StablecoinPaused`

Emitted by: `pause`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `authority` | `Pubkey` | The Pauser who triggered the pause |

After this event, all `mint_tokens` and `burn_tokens` calls will fail with `Paused` until an `unpause` is executed.

---

### `StablecoinUnpaused`

Emitted by: `unpause`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `authority` | `Pubkey` | The Pauser who triggered the unpause |

---

### `RoleUpdated`

Emitted by: `update_roles`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `user` | `Pubkey` | The user whose role was updated |
| `role_type` | `u8` | Role type (0=Minter, 1=Burner, 2=Pauser, 3=Blacklister, 4=Seizer) |
| `active` | `bool` | Whether the role is now active (`true`) or revoked (`false`) |
| `updated_by` | `Pubkey` | The master authority who made the change |

Example (granting Blacklister role):
```json
{
  "name": "RoleUpdated",
  "data": {
    "config": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
    "user": "ComplianceTeam11111111111111111111111111111",
    "roleType": 3,
    "active": true,
    "updatedBy": "4Zw1fXuYuJhkMuMELSZpDhRrtgCqQ5iqSGPuXXFjHmJG"
  }
}
```

---

### `MinterQuotaUpdated`

Emitted by: `update_minter`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `minter` | `Pubkey` | The minter whose quota was updated |
| `new_quota` | `u64` | The new maximum mint quota in base units |
| `updated_by` | `Pubkey` | The master authority who made the change |

---

### `MinterQuotaReset`

Emitted by: `reset_minter_quota`

Resets the `minted` counter in the `MinterQuota` PDA to zero (preserving audit history in event logs). The `quota` value is unchanged.

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `minter` | `Pubkey` | The minter whose counter was reset |
| `previous_minted` | `u64` | The `minted` value before the reset |
| `reset_by` | `Pubkey` | The master authority who triggered the reset |

---

### `AuthorityTransferred`

Emitted by: `transfer_authority` (single-step, deprecated in favor of 2-step)

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `previous_authority` | `Pubkey` | The outgoing master authority |
| `new_authority` | `Pubkey` | The incoming master authority |

---

### `AuthorityTransferProposed`

Emitted by: `propose_authority_transfer`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `current_authority` | `Pubkey` | The current master authority proposing the transfer |
| `pending_authority` | `Pubkey` | The proposed new master authority |
| `proposed_at` | `i64` | Unix timestamp when the proposal was created |

---

### `AuthorityTransferCancelled`

Emitted by: `cancel_authority_transfer`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `cancelled_by` | `Pubkey` | The authority that cancelled the transfer |
| `cleared_pending` | `Pubkey` | The pending authority that was cleared |

---

### `AuthorityTransferAccepted`

Emitted by: `accept_authority_transfer`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `previous_authority` | `Pubkey` | The outgoing master authority |
| `new_authority` | `Pubkey` | The new master authority (formerly `pending_authority`) |

---

### `AddressBlacklisted`

Emitted by: `add_to_blacklist` (SSS-2 only)

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `address` | `Pubkey` | The address that was blacklisted |
| `reason` | `String` | Human-readable justification (max 64 chars) |
| `blacklisted_by` | `Pubkey` | The Blacklister who added the entry |

Example:
```json
{
  "name": "AddressBlacklisted",
  "data": {
    "config": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
    "address": "7Xzw3pQFkHhgx3nL9mVqRsJkYtBnXdWpHcGfZeKuAmPs",
    "reason": "OFAC match: SDN list entry",
    "blacklistedBy": "ComplianceTeam11111111111111111111111111111"
  }
}
```

---

### `AddressUnblacklisted`

Emitted by: `remove_from_blacklist` (SSS-2 only)

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `address` | `Pubkey` | The address removed from the blacklist |
| `removed_by` | `Pubkey` | The Blacklister who removed the entry |

---

### `TokensSeized`

Emitted by: `seize` (SSS-2 only)

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The stablecoin config PDA |
| `from` | `Pubkey` | The token account from which tokens were seized |
| `to` | `Pubkey` | The destination token account (treasury) |
| `amount` | `u64` | Number of tokens seized in base units |
| `seized_by` | `Pubkey` | The Seizer who executed the operation |

Example:
```json
{
  "name": "TokensSeized",
  "data": {
    "config": "8Dp6VmCHHVmx4fEiXMoepkUjJGtFGBNzFvpHgQZVL8JK",
    "from": "SuspectWallet111111111111111111111111111111",
    "to": "TreasuryAccount1111111111111111111111111111",
    "amount": 50000000,
    "seizedBy": "ComplianceTeam11111111111111111111111111111"
  }
}
```

---

## Oracle Program Events

### `OracleInitialized`

Emitted by: `initialize_oracle`

| Field | Type | Description |
|-------|------|-------------|
| `oracle_config` | `Pubkey` | The newly created `OracleConfig` PDA |
| `stablecoin_config` | `Pubkey` | The SSS stablecoin config this oracle is linked to |
| `aggregator` | `Pubkey` | The Switchboard V2 aggregator account address |
| `base_currency` | `String` | The currency code (e.g., "USD", "EUR") |
| `authority` | `Pubkey` | The authority who initialized the oracle |

---

### `OracleConfigUpdated`

Emitted by: `update_oracle_config`

| Field | Type | Description |
|-------|------|-------------|
| `oracle_config` | `Pubkey` | The `OracleConfig` PDA that was updated |
| `authority` | `Pubkey` | The authority who updated the config |

---

### `PriceRefreshed`

Emitted by: `refresh_price` (permissionless crank)

| Field | Type | Description |
|-------|------|-------------|
| `oracle_config` | `Pubkey` | The `OracleConfig` PDA |
| `price` | `u64` | The verified price scaled by `10^price_decimals` |
| `timestamp` | `i64` | Unix timestamp of the price data from the aggregator |
| `aggregator` | `Pubkey` | The Switchboard aggregator that provided the price |

Example (EURUSD at 1.085 with 6 decimals):
```json
{
  "name": "PriceRefreshed",
  "data": {
    "oracleConfig": "HkXP3nwD7fMtZKM8YJXVf5KLQZfZnB8MvZqG3nR5Pnq7",
    "price": 1085000,
    "timestamp": 1710000000,
    "aggregator": "GvDMxPzN6scrhoXgnb6PLi5LQZ6W3tMGGkMqjqsw14sR"
  }
}
```

---

### `ManualPricePushed`

Emitted by: `push_manual_price` (emergency/test override)

| Field | Type | Description |
|-------|------|-------------|
| `oracle_config` | `Pubkey` | The `OracleConfig` PDA |
| `price` | `u64` | The manually set price |
| `authority` | `Pubkey` | The authority who pushed the price |

---

## Privacy Program Events

### `PrivacyInitialized`

Emitted by: `initialize_privacy`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The newly created `PrivacyConfig` PDA |
| `stablecoin_config` | `Pubkey` | The SSS stablecoin config this privacy config is linked to |
| `authority` | `Pubkey` | The authority who initialized the privacy config |
| `auto_approve` | `bool` | Whether new accounts are auto-approved for confidential transfers |

---

### `PrivacyConfigUpdated`

Emitted by: `update_privacy_config`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The `PrivacyConfig` PDA |
| `authority` | `Pubkey` | The authority who updated the config |

---

### `AllowlistEntryAdded`

Emitted by: `add_to_allowlist`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The `PrivacyConfig` PDA |
| `address` | `Pubkey` | The address added to the confidential transfer allowlist |
| `label` | `String` | Human-readable label for the allowlisted address |
| `added_by` | `Pubkey` | The authority who added the entry |

---

### `AllowlistEntryRemoved`

Emitted by: `remove_from_allowlist`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The `PrivacyConfig` PDA |
| `address` | `Pubkey` | The address removed from the allowlist |
| `removed_by` | `Pubkey` | The authority who removed the entry |

---

## SSS-Caps Module Events

### `CapsConfigInitialized`

Emitted by: `initialize_caps_config`

| Field | Type | Description |
|-------|------|-------------|
| `stablecoin_config` | `Pubkey` | The SSS stablecoin config PDA this caps module is attached to |
| `authority` | `Pubkey` | The authority who initialized the caps config |
| `global_cap` | `u64` | The initial global supply cap (`0` = unlimited) |
| `per_minter_cap` | `u64` | The initial per-minter cap (`0` = unlimited) |

---

### `CapsConfigUpdated`

Emitted by: `update_caps_config`

| Field | Type | Description |
|-------|------|-------------|
| `stablecoin_config` | `Pubkey` | The SSS stablecoin config PDA |
| `old_global_cap` | `u64` | The global cap value before the update |
| `new_global_cap` | `u64` | The new global cap value |
| `old_per_minter_cap` | `u64` | The per-minter cap before the update |
| `new_per_minter_cap` | `u64` | The new per-minter cap value |
| `updated_by` | `Pubkey` | The authority who performed the update |

---

## SSS-10 Async Mint/Redeem Events

### `AsyncConfigInitialized`

Emitted by: `initialize_async_config`

| Field | Type | Description |
|-------|------|-------------|
| `async_config` | `Pubkey` | The newly created `AsyncConfig` PDA |
| `stablecoin_config` | `Pubkey` | The stablecoin config this async layer wraps |
| `authority` | `Pubkey` | The authority who governs the request queue |
| `mint` | `Pubkey` | The Token-2022 mint address |

---

### `MintRequested`

Emitted by: `submit_mint_request`

| Field | Type | Description |
|-------|------|-------------|
| `async_config` | `Pubkey` | The async config PDA |
| `request_id` | `u64` | Unique monotonically increasing ID for this request |
| `requester` | `Pubkey` | The address that submitted the request |
| `recipient` | `Pubkey` | The token account that will receive tokens if approved |
| `amount` | `u64` | Number of tokens requested |

---

### `MintApproved`

Emitted by: `approve_mint_request`

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | `u64` | The ID of the approved request |
| `approved_by` | `Pubkey` | The authority that approved the request |

---

### `MintRejected`

Emitted by: `reject_mint_request`

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | `u64` | The ID of the rejected request |
| `rejected_by` | `Pubkey` | The authority that rejected the request |

---

### `MintExecuted`

Emitted by: `execute_mint_request`

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | `u64` | The ID of the executed request |
| `amount` | `u64` | Number of tokens that were minted |

---

### `MintCancelled`

Emitted by: `cancel_mint_request`

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | `u64` | The ID of the cancelled request |
| `cancelled_by` | `Pubkey` | The requester who cancelled |

---

### `RedeemRequested`

Emitted by: `submit_redeem_request`

| Field | Type | Description |
|-------|------|-------------|
| `async_config` | `Pubkey` | The async config PDA |
| `request_id` | `u64` | Unique ID for this redemption request |
| `requester` | `Pubkey` | The address that submitted the request |
| `source_token_account` | `Pubkey` | Token account from which tokens will be redeemed |
| `amount` | `u64` | Number of tokens requested for redemption |

---

### `RedeemApproved`

Emitted by: `approve_redeem_request`

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | `u64` | The ID of the approved redemption request |
| `approved_by` | `Pubkey` | The authority that approved the request |

---

### `RedeemExecuted`

Emitted by: `execute_redeem_request`

| Field | Type | Description |
|-------|------|-------------|
| `request_id` | `u64` | The ID of the executed redemption request |
| `amount` | `u64` | Number of tokens that were redeemed/burned |

---

## Event Summary Table

| Event | Program | Instruction | SSS Preset |
|-------|---------|-------------|------------|
| `StablecoinInitialized` | SSS | `initialize` | All |
| `TokensMinted` | SSS | `mint_tokens` | All |
| `TokensBurned` | SSS | `burn_tokens` | All |
| `AccountFrozen` | SSS | `freeze_token_account` | All |
| `AccountThawed` | SSS | `thaw_token_account` | All |
| `StablecoinPaused` | SSS | `pause` | All |
| `StablecoinUnpaused` | SSS | `unpause` | All |
| `RoleUpdated` | SSS | `update_roles` | All |
| `MinterQuotaUpdated` | SSS | `update_minter` | All |
| `MinterQuotaReset` | SSS | `reset_minter_quota` | All |
| `AuthorityTransferred` | SSS | `transfer_authority` | All |
| `AuthorityTransferProposed` | SSS | `propose_authority_transfer` | All |
| `AuthorityTransferCancelled` | SSS | `cancel_authority_transfer` | All |
| `AuthorityTransferAccepted` | SSS | `accept_authority_transfer` | All |
| `AddressBlacklisted` | SSS | `add_to_blacklist` | SSS-2 |
| `AddressUnblacklisted` | SSS | `remove_from_blacklist` | SSS-2 |
| `TokensSeized` | SSS | `seize` | SSS-2 |
| `OracleInitialized` | Oracle | `initialize_oracle` | Non-USD |
| `OracleConfigUpdated` | Oracle | `update_oracle_config` | Non-USD |
| `PriceRefreshed` | Oracle | `refresh_price` | Non-USD |
| `ManualPricePushed` | Oracle | `push_manual_price` | Non-USD |
| `PrivacyInitialized` | Privacy | `initialize_privacy` | SSS-3 |
| `PrivacyConfigUpdated` | Privacy | `update_privacy_config` | SSS-3 |
| `AllowlistEntryAdded` | Privacy | `add_to_allowlist` | SSS-3 |
| `AllowlistEntryRemoved` | Privacy | `remove_from_allowlist` | SSS-3 |
| `CapsConfigInitialized` | SSS-Caps | `initialize_caps_config` | Module |
| `CapsConfigUpdated` | SSS-Caps | `update_caps_config` | Module |
| `AsyncConfigInitialized` | SSS-10 | `initialize_async_config` | SSS-10 |
| `MintRequested` | SSS-10 | `submit_mint_request` | SSS-10 |
| `MintApproved` | SSS-10 | `approve_mint_request` | SSS-10 |
| `MintRejected` | SSS-10 | `reject_mint_request` | SSS-10 |
| `MintExecuted` | SSS-10 | `execute_mint_request` | SSS-10 |
| `MintCancelled` | SSS-10 | `cancel_mint_request` | SSS-10 |
| `RedeemRequested` | SSS-10 | `submit_redeem_request` | SSS-10 |
| `RedeemApproved` | SSS-10 | `approve_redeem_request` | SSS-10 |
| `RedeemExecuted` | SSS-10 | `execute_redeem_request` | SSS-10 |

---

## Building an Event Indexer

The backend uses a polling approach against the Solana RPC. Here is the core pattern:

```typescript
import { Connection, PublicKey } from "@solana/web3.js";
import { EventParser, BorshCoder } from "@coral-xyz/anchor";

async function indexEvents(
  connection: Connection,
  configPda: PublicKey,
  programId: PublicKey,
  idl: any,
  lastSignature?: string
) {
  const parser = new EventParser(programId, new BorshCoder(idl));

  // Fetch transactions involving the config PDA
  const signatures = await connection.getSignaturesForAddress(configPda, {
    before: lastSignature,
    limit: 100,
  });

  for (const sigInfo of signatures.reverse()) {
    const tx = await connection.getTransaction(sigInfo.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });

    if (!tx?.meta?.logMessages) continue;

    for (const event of parser.parseLogs(tx.meta.logMessages)) {
      await processEvent({
        name: event.name,
        data: event.data,
        signature: sigInfo.signature,
        slot: tx.slot,
        blockTime: tx.blockTime,
      });
    }
  }
}
```

## Webhook Integration

Register webhooks via the backend API to receive real-time notifications when events are indexed:

```bash
curl -X POST http://localhost:3001/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d '{
    "url": "https://your-app.com/hooks/sss",
    "events": ["TokensMinted", "AddressBlacklisted", "TokensSeized"],
    "secret": "your-hmac-secret"
  }'
```

The payload delivered to your endpoint:
```json
{
  "id": "delivery-uuid",
  "event_type": "TokensMinted",
  "timestamp": "2026-03-13T10:00:00Z",
  "transaction_signature": "5N8wzC2K...",
  "data": {
    "config": "8Dp6Vm...",
    "minter": "4Zw1fX...",
    "recipient": "9WzDXw...",
    "amount": 1000000,
    "minterTotalMinted": 5000000
  }
}
```
