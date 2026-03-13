---
name: stablecoin-standard-dev
description: Solana Stablecoin Standard (SSS) development playbook. Covers Anchor program development for regulated stablecoins, Token-2022 extensions, compliance enforcement, transfer hooks, role-based access control, and testing with Surfpool/Trident.
user-invocable: true
---

# Solana Stablecoin Standard Skill

## What this Skill is for

Use this Skill when the user asks for:
- Regulated stablecoin implementation on Solana
- Token-2022 extension composition for compliance
- Transfer hook blacklist enforcement
- Role-based access control for minting/burning/freezing
- Minter quota management
- SSS preset selection (SSS-1 vs SSS-2 vs SSS-3)
- GENIUS Act compliance mapping
- Anchor program development for stablecoins
- Testing strategies for stablecoin programs

## Core Stablecoin Concepts

### SSS Presets

| Feature | SSS-1 (Minimal) | SSS-2 (Compliant) | SSS-3 (Private) |
|---------|-----------------|-------------------|-----------------|
| Mint/Burn | yes | yes | yes |
| Freeze/Pause | yes | yes | yes |
| Roles (5 types) | yes | yes | yes |
| Transfer Hook | no | **yes** | no |
| Permanent Delegate | no | **yes** | no |
| Blacklist/Seize | no | **yes** | no |
| Confidential Transfer | no | no | **yes** |

### Role Types

| Role | Value | Capability |
|------|-------|------------|
| Minter | 0 | Mint tokens up to quota |
| Burner | 1 | Burn tokens from own account |
| Pauser | 2 | Pause/unpause all operations |
| Blacklister | 3 | Add/remove blacklist entries (SSS-2) |
| Seizer | 4 | Seize tokens from blacklisted (SSS-2) |

### PDA Seeds

```
Config:           ["stablecoin", mint]
Role:             ["role", config, role_type_u8, user]
MinterQuota:      ["minter_quota", config, minter]
BlacklistEntry:   ["blacklist", config, address]
ExtraAccountMetas: ["extra-account-metas", mint]  (hook program)
OracleConfig:     ["oracle_config", config]  (oracle program)
```

## Technology Stack

| Layer | Tool |
|-------|------|
| Programs | Anchor 0.31+ |
| Token Standard | SPL Token-2022 |
| Extensions | MintCloseAuthority, PermanentDelegate, TransferHook, MetadataPointer, ConfidentialTransfer |
| Testing | Surfpool (mainnet fork), Trident (fuzz), Mocha (integration) |
| SDK | TypeScript (@coral-xyz/anchor, @solana/web3.js) |
| CLI | commander.js |
| Backend | Rust/Axum |

## Operating Procedure

### 1. Classify the task

- Program logic (new instruction, modify existing)
- Compliance feature (blacklist, seize, freeze, role management)
- SDK/CLI integration
- Testing
- Deployment

### 2. Implementation Checklist

- [ ] Correct SSS preset for the feature
- [ ] Feature gates checked for SSS-2 operations
- [ ] Role authorization verified
- [ ] Checked arithmetic throughout
- [ ] Events emitted for all state changes
- [ ] PDA bumps stored, not recalculated
- [ ] Two-step authority transfer pattern

### 3. Testing Requirements

- Unit test each instruction
- Integration test full flows (mint -> transfer -> blacklist -> seize)
- Fuzz test with random amounts and role combinations
- Negative tests (unauthorized, paused, quota exceeded)

## Progressive Disclosure

### Programs & Development
- [programs-anchor.md](programs-anchor.md) - Anchor patterns and security
- [../rules/anchor.md](../rules/anchor.md) - Anchor code rules

### Testing
- [../commands/test-rust.md](../commands/test-rust.md) - Rust test suites
- [../commands/test-typescript.md](../commands/test-typescript.md) - TS test suites

### Ecosystem
- [ecosystem.md](ecosystem.md) - Token standards, DeFi, oracles
- [resources.md](resources.md) - Official documentation links

## Task Routing Guide

| User asks about... | Primary file(s) |
|--------------------|-----------------|
| Anchor program code | programs-anchor.md, ../rules/anchor.md |
| Testing | ../commands/test-rust.md, test-typescript.md |
| Security review | ../commands/audit-solana.md |
| Deployment | ../commands/deploy.md |
| Token-2022 extensions | ecosystem.md |
| IDL generation | idl-codegen.md |
