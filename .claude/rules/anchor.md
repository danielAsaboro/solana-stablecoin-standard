---
paths:
  - "programs/**/src/**/*.rs"
---

# Anchor Program Rules (Comprehensive Reference)

## Core Macros

### `declare_id!()`
Declares the onchain program address from project keypair.

### `#[program]`
Marks module containing instruction entrypoints.

### `#[derive(Accounts)]`
Lists accounts an instruction requires with constraint enforcement.

### `#[error_code]`
Enables custom error types with `#[msg(...)]` attributes.

## Account Types

| Type | Purpose |
|------|---------|
| `Signer<'info>` | Verifies account signed the transaction |
| `Account<'info, T>` | Typed program account with validation |
| `InterfaceAccount<'info, T>` | Token-2022 compatible typed account |
| `Interface<'info, T>` | Token-2022 compatible program account |
| `Program<'info, T>` | Validates executable program accounts |
| `UncheckedAccount<'info>` | Raw account requiring manual validation |

## Account Constraints

### Initialization
```rust
#[account(
    init,
    payer = payer,
    space = 8 + StablecoinConfig::INIT_SPACE,
    seeds = [b"stablecoin", mint.key().as_ref()],
    bump
)]
pub config: Account<'info, StablecoinConfig>,
```

### PDA Validation (stored bump)
```rust
#[account(
    seeds = [b"stablecoin", config.mint.as_ref()],
    bump = config.bump  // ALWAYS use stored bump
)]
pub config: Account<'info, StablecoinConfig>,
```

### Ownership and Relationships
```rust
#[account(
    mut,
    has_one = authority @ SSSError::Unauthorized,
    constraint = !config.is_paused @ SSSError::Paused
)]
pub config: Account<'info, StablecoinConfig>,
```

### Closing Accounts
```rust
#[account(
    mut,
    close = destination,
    has_one = authority
)]
pub role: Account<'info, Role>,
```

## PDA Management (CRITICAL)

**ALWAYS store canonical bump — saves ~1500 CU per access:**

```rust
#[account]
#[derive(InitSpace)]
pub struct StablecoinConfig {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,  // ALWAYS STORE THIS
    pub is_paused: bool,
    pub enable_transfer_hook: bool,
    pub enable_permanent_delegate: bool,
}

// Store on init
config.bump = ctx.bumps.config;

// Use stored bump for CPIs
let seeds = &[b"stablecoin", config.mint.as_ref(), &[config.bump]];
```

### SSS PDA Seeds
```
Config:           [b"stablecoin", mint]
Role:             [b"role", config, role_type_u8, user]
MinterQuota:      [b"minter_quota", config, minter]
BlacklistEntry:   [b"blacklist", config, address]
ExtraAccountMetas: [b"extra-account-metas", mint]
OracleConfig:     [b"oracle_config", stablecoin_config]
```

## Arithmetic Safety

**ALWAYS use checked arithmetic. NEVER use unchecked operations.**

```rust
// Correct
let new_supply = mint.supply
    .checked_add(amount)
    .ok_or(SSSError::Overflow)?;

quota.remaining = quota.remaining
    .checked_sub(amount)
    .ok_or(SSSError::QuotaExceeded)?;

// WRONG - can panic
let new_supply = mint.supply + amount;
```

## Error Handling

**NEVER use `unwrap()` or `expect()` in program code.**

```rust
#[error_code]
pub enum SSSError {
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Minter quota exceeded")]
    QuotaExceeded,
    #[msg("Stablecoin is paused")]
    Paused,
    #[msg("Address is blacklisted")]
    Blacklisted,
    #[msg("Feature not enabled for this preset")]
    FeatureNotEnabled,
    #[msg("Unauthorized: missing required role")]
    Unauthorized,
    #[msg("Invalid authority transfer")]
    InvalidAuthorityTransfer,
}
```

## Cross-Program Invocations

### Token-2022 Mint with PDA Signer
```rust
let seeds = &[b"stablecoin", config.mint.as_ref(), &[config.bump]];
let signer_seeds = &[&seeds[..]];

mint_to(
    CpiContext::new_with_signer(
        ctx.accounts.token_program.to_account_info(),
        MintTo { mint, to, authority: config.to_account_info() },
        signer_seeds,
    ),
    amount,
)?;
```

### Account Reloading After CPI
```rust
// CRITICAL: Anchor doesn't auto-update after CPI
ctx.accounts.token_account.reload()?;
```

## Token-2022 Specifics

### Interface Accounts
```rust
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

pub mint: InterfaceAccount<'info, Mint>,
pub token_account: InterfaceAccount<'info, TokenAccount>,
pub token_program: Interface<'info, TokenInterface>,
```

### Transfer Hook Caveat
`anchor_spl::token_interface::transfer_checked` does NOT forward `remaining_accounts`.
Use raw `invoke_signed` with `spl_token_2022::instruction::transfer_checked` for transfer hooks.

### SPL Transfer Hook Discriminator
```rust
// NOT an Anchor discriminator — need fallback handler
const EXECUTE_DISCRIMINATOR: [u8; 8] = [105, 37, 101, 197, 75, 251, 102, 26];
```

## Event Emission

```rust
#[event]
pub struct TokensMinted {
    #[index]
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

emit!(TokensMinted { ... });
```

## Anti-Patterns

| Don't | Do Instead |
|-------|------------|
| `unwrap()` in programs | `ok_or(ErrorCode::...)` |
| Unchecked arithmetic | `checked_add`, `checked_sub` |
| Recalculate bumps | Store canonical bump |
| Skip validation | Use Anchor constraints |
| `init_if_needed` | Separate init instruction |
| Trust CPI return data | Validate program ID |
| Single-step authority | Two-step propose -> accept |

## Security Checklist (Per Instruction)

- [ ] All accounts validated
- [ ] Checked arithmetic throughout
- [ ] No `unwrap()` or `expect()`
- [ ] PDA bumps stored and reused
- [ ] CPI targets validated
- [ ] Feature gates checked for SSS-2 ops
- [ ] Role authorization verified
- [ ] Events emitted
