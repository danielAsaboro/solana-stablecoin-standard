# Solana Stablecoin Standard (SSS)

Modular, compliance-ready stablecoin toolkit for Solana. Three presets — from minimal (SSS-1) to fully regulated with transfer hooks and seizure (SSS-2) to privacy-preserving with confidential transfers (SSS-3).

**Stack**: Anchor 0.31+, Rust 1.82+, Token-2022, TypeScript
**Reference**: `docs/SSS-1.md`, `docs/SSS-2.md` for standard specifications

## Skills & Commands

Run `/quick-commit`, `/build-program`, `/test-rust`, `/test-typescript`, `/deploy`, `/audit-solana`, `/test-and-fix`, `/plan-feature`, `/explain-code`, `/write-docs`, `/setup-ci-cd` for workflows.
Agents: `solana-architect`, `anchor-engineer`, `solana-qa-engineer`, `tech-docs-writer`, `compliance-engineer`, `solana-researcher`
Details in `.claude/commands/`, `.claude/agents/`, `.claude/skills/`

## Standards

- Build → Format → Lint → Test before commit
- Devnet first, mainnet only with explicit confirmation
- Feature gates enforced on-chain (SSS-1 can never gain SSS-2 capabilities)
- Round supply counters conservatively (checked arithmetic everywhere)
- Two-step authority transfer (propose → accept)

## Anti-Patterns (Growing List)

**Security - NEVER:**
- `unwrap()` in program code
- Unchecked arithmetic — use `checked_add`, `checked_sub`
- Recalculate PDA bumps — store canonical bumps
- Skip account validation (owner, signer, PDA derivation)
- Deploy mainnet without explicit user confirmation
- Trust CPI return data without validating target program ID
- Single-step authority transfer (always propose → accept)

**Code Quality - NEVER:**
- Comments stating the obvious (`// increment counter` before `counter += 1`)
- Defensive try/catch blocks abnormal for the codebase
- Verbose error messages where simple ones suffice
- Import unused dependencies
- Create abstractions for one-time operations
- Add features beyond what was asked

**AI Slop - ALWAYS REMOVE:**
- Excessive inline comments on self-explanatory code
- Redundant validation of already-validated data
- Style inconsistent with surrounding code
- Empty error handling blocks
- `// TODO: implement` without actual implementation plan

**Stablecoin-Specific - NEVER:**
- Allow SSS-2 instructions without feature gate check
- Seize without verifying BlacklistEntry PDA exists
- Mint beyond minter quota without error
- Skip ExtraAccountMetaList init during SSS-2 setup
- Initialize SSS-2 config without hookProgram.programId

## Lessons Learned

**2026-03: Token-2022 transfer hooks + Anchor**
- SPL Transfer Hook Execute discriminator `[105, 37, 101, 197, 75, 251, 102, 26]` is NOT Anchor-native
- Need `fallback` handler in Anchor program for non-Anchor discriminator
- `anchor_spl::token_interface::transfer_checked` does NOT forward `remaining_accounts` — use raw `invoke_signed`
- ExtraAccountMetas uses `Seed::AccountData` for dynamic PDA resolution from token account owners

**2026-03: Surfpool + Anchor testing**
- Must start from project root with `--network mainnet --yes --legacy-anchor-compatibility`
- Surfpool is stateless — `--yes` re-runs deployment runbook on each start
- `ticks_per_slot = 100` + `startup_wait = 45000` stabilizes tests
- Use `{ commitment: "confirmed" }` provider to avoid blockhash expiration

**2026-02: ConfidentialTransfer + TransferHook incompatibility**
- Token-2022 rejects combining these extensions on the same mint
- SSS-3 uses account approval gating instead of transfer-time hooks

**2026-03: Token-2022 metadata space**
- Metadata space must be pre-funded: `create_account` with base extension space but lamports for `space + metadata_space`
- `anchor_spl::token_interface` re-exports from `token_2022` module

## Review Checklist

Before merge, run `git diff main...HEAD` and verify:
- No AI slop introduced
- Error handling matches existing patterns
- No unnecessary abstractions added
- Security checks present where needed
- Feature gates checked for all SSS-2 instructions
- Events emitted for all state changes
- Minter quotas enforced on every mint
- Two-step authority pattern used for transfers
