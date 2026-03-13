---
description: "Security audit for SSS Solana programs"
---

You are conducting a security audit for the SSS stablecoin programs. This is CRITICAL.

## Pre-Audit Checklist

- [ ] All tests passing
- [ ] Code compiles without warnings
- [ ] No hardcoded keys or secrets

## Step 1: Automated Analysis

```bash
# Dependency audit
cargo audit

# Clippy with strict security lints
cargo clippy --all-targets -- \
    -W clippy::all \
    -W clippy::pedantic \
    -W clippy::unwrap_used \
    -W clippy::expect_used \
    -W clippy::panic \
    -W clippy::arithmetic_side_effects \
    -D warnings

# Format check
cargo fmt --check

# Run full test suite
anchor build && anchor test --skip-build
```

## Step 2: Account Validation Review

For EVERY instruction, verify:
- [ ] All signers are checked
- [ ] PDA seeds are correct and bumps are stored
- [ ] `has_one` constraints validate relationships
- [ ] Feature gates checked for SSS-2 instructions
- [ ] Role authorization verified before privileged operations

## Step 3: Arithmetic Safety

- [ ] All math uses `checked_add`, `checked_sub`, `checked_mul`, `checked_div`
- [ ] No integer overflow possible in supply calculations
- [ ] Minter quota arithmetic is safe
- [ ] No division by zero paths

## Step 4: Access Control

- [ ] Role checks on all privileged instructions
- [ ] Authority transfer is two-step (propose -> accept)
- [ ] Blacklist operations require correct role + feature gate
- [ ] Seize requires both blacklist entry AND permanent delegate

## Step 5: CPI Security

- [ ] CPI targets validated (Program<'info, T> or hardcoded)
- [ ] Transfer hook discriminator handled via fallback
- [ ] ExtraAccountMetas properly initialized
- [ ] No trust of unvalidated CPI return data

## Step 6: Stablecoin-Specific

- [ ] SSS-1 configs can never execute SSS-2 instructions
- [ ] Feature gates are immutable after initialization
- [ ] Minter quotas enforced on every mint
- [ ] Blacklist checked on every transfer (via hook)
- [ ] Seize only works on blacklisted addresses
- [ ] Events emitted for all state changes
