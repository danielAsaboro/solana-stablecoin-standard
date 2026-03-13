---
description: "Explain code with visual diagrams and step-by-step breakdowns"
---

Explain the selected code or file with clear, structured breakdowns.

## Approach

1. **Identify the code scope** - file, function, instruction, or module
2. **Determine audience level** - adjust depth accordingly

## Explanation Structure

### For Anchor Instructions
1. What the instruction does (one sentence)
2. Account layout (table of accounts and their roles)
3. Step-by-step execution flow
4. Security checks (what prevents misuse)
5. Events emitted

### For PDA Derivations
1. Seed components and their purpose
2. Why these seeds ensure uniqueness
3. Bump storage and usage pattern

### For CPI Flows
1. Source program and instruction
2. Target program and expected behavior
3. Account passing and signer seeds
4. Post-CPI state changes

### For SDK Functions
1. What it does
2. Parameters and return type
3. PDA derivations performed
4. Transaction(s) built
5. Error conditions

## Visual Aids

Use ASCII diagrams for complex flows:
```
User -> SSS Program -> Transfer Hook -> BlacklistEntry PDA
                                     -> ExtraAccountMetas PDA
```

Use tables for account layouts and comparison matrices.
