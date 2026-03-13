# ERC-20 / USDC Architecture Comparison

A reference guide for EVM developers building on SSS. This document maps Ethereum/ERC-20 concepts to their Solana/SSS equivalents.

---

## Overview

Ethereum and Solana have fundamentally different execution models. ERC-20 tokens store all state in a single smart contract. Solana programs store state in separate accounts owned by the program. This shapes every design decision from how balances work to how approvals and events are handled.

---

## State Model: Accounts vs Storage Slots

### ERC-20 / Solidity

```solidity
contract ERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    // All state lives in this contract's storage
}
```

All state is in the contract's storage trie, keyed by storage slots. There is one contract object per token, and balance lookups are O(1) hash lookups in the EVM state trie.

### SSS / Solana Token-2022

```
Mint Account (Token-2022)
  └── Extensions: MetadataPointer, PermanentDelegate, TransferHook, ConfidentialTransferMint

Token Account (per user)
  ├── owner: Pubkey
  ├── mint: Pubkey
  ├── amount: u64
  └── Extensions: ConfidentialTransferAccount (per-user El Gamal key)

StablecoinConfig PDA
  ├── master_authority: Pubkey
  ├── total_minted: u64
  ├── total_burned: u64
  ├── paused: bool
  └── supply_cap: u64
```

Key difference: In Solana, each user's balance is stored in their own `TokenAccount`. There is no global `balanceOf` mapping. Instead, Associated Token Accounts (ATAs) are deterministically derived from the user's wallet and the mint address.

### Comparison Table

| Concept | ERC-20 | SSS / Token-2022 |
|---------|--------|-----------------|
| Balance storage | `balanceOf[address]` in contract storage | Separate `TokenAccount` PDA per user |
| Balance lookup | Single storage slot read | Fetch the user's ATA |
| Global state | Contract storage | `StablecoinConfig` PDA |
| State ownership | Contract owns all state | Each account is owned by the Token-2022 program |
| State size | Dynamic (grows with users) | Fixed per account, rent-exempt |
| State fees | Gas for storage writes | Rent for account creation (~0.002 SOL per account) |

---

## Authority Model: Roles vs Owner

### ERC-20 / USDC

USDC uses OpenZeppelin's `AccessControl` with a hierarchical role system:

```solidity
bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
bytes32 public constant BLACKLISTER_ROLE = keccak256("BLACKLISTER_ROLE");
bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

// Roles are stored in a mapping per role per address
mapping(bytes32 => mapping(address => bool)) private _roles;
```

### SSS

SSS uses separate PDA accounts for each (config, role_type, user) triple:

```
RoleAccount PDA ["role", config, role_type_u8, user]
  ├── config: Pubkey
  ├── user: Pubkey
  ├── role_type: u8
  └── active: bool
```

| Aspect | ERC-20 / USDC | SSS |
|--------|---------------|-----|
| Role storage | Nested mapping in contract | Separate PDA per (config, role, user) |
| Role check cost | Single storage read (warm/cold) | Single account fetch (cached in tx) |
| Role assignment | Transaction by role admin | `update_roles` by master authority |
| Role revocation | Clear mapping entry | Set `RoleAccount.active = false` (PDA persists) |
| Multiple role holders | Yes, via mapping | Yes, unlimited PDAs |
| Role enumeration | Requires event indexing | Requires gPA query |
| Admin authority | `DEFAULT_ADMIN_ROLE` holder | `StablecoinConfig.master_authority` |
| Authority transfer | `transferOwnership` | 2-step: `propose_authority_transfer` + `accept_authority_transfer` |

---

## Transfer Mechanics

### ERC-20

```solidity
function transfer(address to, uint256 amount) external returns (bool) {
    _balances[msg.sender] -= amount;
    _balances[to] += amount;
    emit Transfer(msg.sender, to, amount);
    return true;
}
```

### Solana Token-2022 (SSS)

```typescript
// Client initiates transfer
await createTransferCheckedInstruction(
  sourceTokenAccount,
  mint,
  destinationTokenAccount,
  owner,
  amount,
  decimals,
  [],
  TOKEN_2022_PROGRAM_ID
);
```

For SSS-2, this call triggers the Transfer Hook CPI flow:

```
User calls transfer_checked
  → Token-2022 Program
    → Reads TransferHook extension from mint
    → Resolves ExtraAccountMetas PDA
    → CPIs to Transfer Hook Program
      → Checks BlacklistEntry PDAs for source & dest owners
      → If blacklisted: return error (transfer rolls back)
      → If not: return Ok
    → Token-2022 completes transfer
```

### Comparison Table

| Aspect | ERC-20 | SSS / Token-2022 |
|--------|--------|-----------------|
| Transfer entry point | Contract `transfer()` | Token-2022 `transfer_checked` |
| Amount validation | Checked in contract | `transfer_checked` enforces decimals |
| Hook mechanism | ERC-777 send hooks / ERC-1363 callbacks | SPL Transfer Hook Interface (on-chain CPI) |
| Hook gas | Paid by sender as part of tx | Compute budget shared in tx |
| Blacklist check | Inside `transfer()` function | Transfer hook CPI (separate program) |
| Decimals enforcement | Optional (applications handle) | Mandatory in `transfer_checked` |
| Fee on transfer | Not standard (ERC-2612 extension) | Possible via Transfer Fee extension |

---

## Approval Model

### ERC-20 Approve/TransferFrom

```solidity
function approve(address spender, uint256 amount) external {
    allowance[msg.sender][spender] = amount;
}

function transferFrom(address from, address to, uint256 amount) external {
    allowance[from][msg.sender] -= amount;
    _balances[from] -= amount;
    _balances[to] += amount;
}
```

### Token-2022 Delegation

```typescript
// User approves a delegate to spend from their token account
await approveChecked(
  connection,
  payer,
  mint,
  sourceTokenAccount,
  delegatePubkey,
  owner,
  delegatedAmount,
  decimals,
  [],
  TOKEN_2022_PROGRAM_ID
);

// Delegate executes the transfer
await transferChecked(
  connection,
  payer,
  sourceTokenAccount,
  mint,
  destinationTokenAccount,
  delegate,
  amount,
  decimals,
  [],
  TOKEN_2022_PROGRAM_ID
);
```

### Permanent Delegate (SSS-2 Seizure)

The `PermanentDelegate` extension allows a designated address (the SSS config PDA) to transfer tokens from any account at any time without an explicit approval. This is the mechanism behind the `seize` instruction:

```typescript
// Config PDA is permanent delegate — no explicit approval needed
await sssProgram.methods.seize(amount).accounts({
  config: configPda,  // signs as permanent delegate
  sourceTokenAccount: victimAccount,
  destinationTokenAccount: treasuryAccount,
  // ...
}).rpc();
```

### Comparison Table

| Aspect | ERC-20 Approve | Token-2022 Delegate |
|--------|---------------|---------------------|
| Standard flow | `approve` + `transferFrom` | `approve` on token account + `transferChecked` |
| Allowance storage | `allowance[owner][spender]` in contract | `delegate` + `delegated_amount` in TokenAccount |
| Infinite approval | `approve(type(uint256).max)` | `approveChecked(u64::MAX)` |
| Revocation | `approve(0)` | `revoke` instruction |
| Force transfer | Not in standard ERC-20 (USDC adds admin functions) | `PermanentDelegate` extension |
| Seizure mechanism | USDC `blacklist` + admin `transferFrom` | `seize` via config PDA as permanent delegate |

---

## Minting

### ERC-20 / USDC

```solidity
function mint(address to, uint256 amount) external onlyMinters {
    totalSupply += amount;
    balanceOf[to] += amount;
    emit Transfer(address(0), to, amount);
}
```

### SSS

```rust
pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    // 1. Verify Minter role
    require!(ctx.accounts.role_account.active, StablecoinError::Unauthorized);
    // 2. Check quota
    require!(
        minter_quota.minted.checked_add(amount)? <= minter_quota.quota,
        StablecoinError::QuotaExceeded
    );
    // 3. Check not paused
    require!(!config.paused, StablecoinError::Paused);
    // 4. Check supply cap
    if config.supply_cap > 0 {
        require!(
            config.total_minted.checked_add(amount)? <= config.supply_cap,
            StablecoinError::SupplyCapExceeded
        );
    }
    // 5. CPI to Token-2022 mint_to
    mint_to(cpi_ctx, amount)?;
    // 6. Update state
    config.total_minted = config.total_minted.checked_add(amount)?;
    minter_quota.minted = minter_quota.minted.checked_add(amount)?;
    // 7. Emit event
    emit!(TokensMinted { ... });
    Ok(())
}
```

| Aspect | ERC-20 / USDC | SSS |
|--------|---------------|-----|
| Minting authority | Addresses with `MINTER_ROLE` | Addresses with `RoleAccount.role_type = 0` |
| Quota enforcement | Not standard (USDC uses manual limits) | Per-minter `MinterQuota` PDA with `quota` field |
| Supply cap | Not standard | `StablecoinConfig.supply_cap` |
| Mint event | `Transfer(address(0), to, amount)` | `TokensMinted { minter, recipient, amount }` |
| Paused check | Custom (`whenNotPaused` modifier) | `config.paused` flag |

---

## Burning

### ERC-20 / USDC

```solidity
function burn(uint256 amount) external {
    balanceOf[msg.sender] -= amount;
    totalSupply -= amount;
    emit Transfer(msg.sender, address(0), amount);
}

// USDC has burnFrom for controllers
function burnFrom(address account, uint256 amount) external onlyMinters {
    allowance[account][msg.sender] -= amount;
    balanceOf[account] -= amount;
    totalSupply -= amount;
}
```

### SSS

Any address with the `Burner` role (role type `1`) can call `burn_tokens` on a token account. Note that a Burner must own or have delegation over the source account:

```typescript
await sssProgram.methods
  .burnTokens(new BN(amount))
  .accounts({
    config: configPda,
    mint: mintAddress,
    fromTokenAccount: sourceAta,
    roleAccount: burnerRolePda,
    burner: burner.publicKey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

---

## Supply Cap Enforcement

### ERC-20

Most ERC-20 tokens have no built-in supply cap. USDC implements an off-chain process.

### SSS

Two layers of supply cap enforcement:

1. **SSS-native**: `StablecoinConfig.supply_cap` (set at initialization, updatable by master authority)
2. **SSS-Caps module**: `CapsConfig.global_cap` and `CapsConfig.per_minter_cap` (separate authority, passed via `remaining_accounts`)

```
Total supply cap = min(config.supply_cap, caps_config.global_cap)
Per-minter cap   = min(minter_quota.quota, caps_config.per_minter_cap)
```

---

## Compliance Features

### USDC (ERC-20 Blacklist)

```solidity
mapping(address => bool) internal blacklisted;

function blacklist(address _account) external onlyBlacklister {
    blacklisted[_account] = true;
    emit Blacklisted(_account);
}

function transfer(address to, uint256 value) external {
    require(!blacklisted[msg.sender], "Blacklisted");
    require(!blacklisted[to], "Blacklisted");
    // ...
}
```

USDC's blacklist is enforced inside the `transfer` function. The check only fires when a transfer occurs.

### SSS-2 (Transfer Hook Blacklist)

The SSS blacklist is enforced by the Transfer Hook program, which is invoked by Token-2022 on every `transfer_checked`. Even direct Token-2022 transfers (not through the SSS program) are blocked:

```
Any transfer → Token-2022 → Transfer Hook CPI → Blacklist PDA check
```

This is stronger than ERC-20 blacklisting because it cannot be bypassed by calling Token-2022 directly. Any token movement that uses `transfer_checked` (required for Token-2022) will be intercepted.

| Aspect | USDC / ERC-20 | SSS-2 |
|--------|---------------|-------|
| Blacklist storage | `mapping(address => bool)` | `BlacklistEntry` PDA per address |
| Enforcement point | `transfer()` function | Transfer Hook CPI on every `transfer_checked` |
| Bypass possible | No (if using the contract) | No (Token-2022 enforces hook) |
| Reason field | Not standard | `BlacklistEntry.reason` (max 64 bytes) |
| Timestamp | Not standard | `BlacklistEntry.blacklisted_at` (Unix timestamp) |
| Auditor field | Not standard | `BlacklistEntry.blacklisted_by` |

---

## Privacy

### ERC-20

ERC-20 transfers are fully transparent on-chain. Tornado Cash and similar systems attempt off-chain privacy but are legally restricted.

### SSS-3 (Confidential Transfers)

Token-2022's `ConfidentialTransferMint` extension uses El Gamal encryption and Bulletproof-style zero-knowledge range proofs. Amounts are hidden on-chain, but:

- The existence of a transfer is still visible
- A designated auditor with the auditor El Gamal key can decrypt all amounts
- A KYC allowlist (Privacy Program) gates access to confidential mode

| Aspect | ERC-20 | SSS-3 |
|--------|--------|-------|
| Amount visibility | Fully public | Encrypted (El Gamal) |
| Sender/receiver | Fully public | Fully public (only amounts are hidden) |
| Auditor access | Requires chain analysis | Auditor key can decrypt all amounts |
| ZK proofs | Not applicable | Bulletproof-style range proofs |
| Regulatory compatibility | Transparent, no privacy | Auditable privacy (auditor key) |

---

## Event Model

### Solidity Events (ERC-20)

```solidity
event Transfer(address indexed from, address indexed to, uint256 value);
event Approval(address indexed owner, address indexed spender, uint256 value);

// Events are stored in the transaction receipt's log bloom
// Indexed parameters allow log filtering
```

Events are part of the EVM execution receipt and are indexed by Ethereum nodes.

### Anchor Events (SSS)

```rust
#[event]
pub struct TokensMinted {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub minter_total_minted: u64,
}

// Emitted via: emit!(TokensMinted { ... });
// Appears in transaction logs as: "Program data: <base64-borsh>"
```

| Aspect | Solidity Events | Anchor Events |
|--------|----------------|---------------|
| Storage location | Transaction receipt logs | Transaction log messages |
| Indexing | Indexed parameters in ABI | No native indexing (requires off-chain indexer) |
| Filtering | `eth_getLogs` with bloom filter | `getSignaturesForAddress` + log parsing |
| Encoding | ABI-encoded | Borsh-encoded |
| Subscription | `eth_subscribe("logs")` | `program.addEventListener()` via WebSocket |
| Cost | Gas per event log (375 + 8 per byte) | Included in compute budget |

---

## Migration Guide for ERC-20 Developers

### Mental Model Shift

| ERC-20 Concept | Solana/SSS Equivalent | Notes |
|----------------|----------------------|-------|
| Contract address | Program ID | Fixed, deployed via keypair |
| `msg.sender` | Instruction signer | First signer in the accounts list |
| Storage mapping | PDA accounts | Deterministically derived |
| `balanceOf[address]` | ATA address | `getOrCreateAssociatedTokenAccount` |
| `totalSupply` | `config.total_minted - config.total_burned` | Read from `StablecoinConfig` PDA |
| `emit Event(...)` | `emit!(EventStruct {...})` | Anchor macro |
| `onlyOwner` modifier | Check `config.master_authority == signer` | Role PDA check |
| `require(condition)` | `require!(condition, ErrorCode)` | Anchor require macro |
| Payable / ETH value | SOL lamports in accounts | Separate from token operations |
| `address(this)` | `program.programId` | Or the config PDA pubkey |

### TypeScript: Checking a Balance

```typescript
// ERC-20 (ethers.js)
const balance = await token.balanceOf(userAddress);

// SSS (Token-2022)
import { getAccount, getAssociatedTokenAddress } from "@solana/spl-token";
const ata = await getAssociatedTokenAddress(mint, userWallet, false, TOKEN_2022_PROGRAM_ID);
const account = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
const balance = account.amount; // bigint
```

### TypeScript: Transferring Tokens

```typescript
// ERC-20 (ethers.js)
await token.transfer(recipientAddress, amount);

// SSS (Token-2022)
import { createTransferCheckedInstruction } from "@solana/spl-token";
const ix = createTransferCheckedInstruction(
  sourceAta,
  mint,
  destinationAta,
  ownerPubkey,
  amount,
  decimals,
  [],
  TOKEN_2022_PROGRAM_ID
);
await sendAndConfirmTransaction(connection, new Transaction().add(ix), [owner]);
```

### TypeScript: Listening for Events

```typescript
// ERC-20 (ethers.js)
token.on("Transfer", (from, to, value, event) => {
  console.log(`Transfer: ${from} -> ${to} : ${value}`);
});

// SSS (Anchor)
const listenerId = sssProgram.addEventListener("TokensMinted", (event, slot) => {
  console.log(`Mint: ${event.amount} -> ${event.recipient.toString()}`);
});
```

### Key Differences to Remember

1. **Accounts must exist before use**: In Solana, the destination ATA must be created before tokens can be sent there. Use `getOrCreateAssociatedTokenAccount` in client code.

2. **Signed transactions have a size limit**: 1,232 bytes total. Batch at most 3-4 complex instructions per transaction.

3. **All accounts must be listed**: Every account read or written by an instruction must be declared. Dynamic account resolution happens at the CPI level (Transfer Hook), not client-side.

4. **Rent**: Account creation costs a one-time rent-exempt deposit (~0.002 SOL). This is returned when the account is closed.

5. **No re-entrancy but be careful with CPI**: Solana has no re-entrancy issue (programs cannot call themselves), but CPIs can invoke other programs. Always verify CPI target program IDs.

6. **Decimal handling**: `transfer_checked` requires explicit decimals parameter. Amounts are always in base units. A 6-decimal token with `amount = 1_000_000` transfers 1.000000 tokens.
