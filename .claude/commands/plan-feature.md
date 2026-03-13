---
description: "Plan a new feature with technical specification"
---

Plan a new feature for the SSS stablecoin system with full technical specification.

## Step 1: Understand the Request

Clarify:
- Which SSS preset(s) does this affect? (SSS-1, SSS-2, SSS-3)
- Is this a new program, new instruction, or module?
- Does it require new PDAs or account structures?
- Are there regulatory implications?

## Step 2: Architecture Design

- Define new account structures with space calculations
- Design PDA seeds (avoid collisions with existing seeds)
- Identify CPI interactions with existing programs
- Determine if feature gates are needed

## Step 3: Instruction Design

For each new instruction:
- Account list with constraints
- Parameters and validation
- State transitions
- Events to emit
- Error conditions

## Step 4: Testing Plan

- Unit tests (individual instruction validation)
- Integration tests (multi-instruction flows)
- Fuzz tests (edge cases)
- Negative tests (unauthorized access, invalid state)

## Step 5: Implementation Plan

Ordered steps with dependencies:
1. Account structures and state
2. Instruction handlers
3. Tests
4. SDK support
5. CLI commands
6. Documentation

## Step 6: Security Review

- Access control requirements
- Arithmetic safety
- Feature gate implications
- Upgrade path considerations
