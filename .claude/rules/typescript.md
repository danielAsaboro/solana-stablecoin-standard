---
paths:
  - "sdk/**/*.ts"
  - "cli/**/*.ts"
  - "tests/**/*.ts"
  - "frontend/**/*.{ts,tsx}"
exclude:
  - "**/node_modules/**"
  - "**/dist/**"
  - "**/*.d.ts"
---

# TypeScript Standards for SSS

These rules apply to SDK, CLI, tests, and frontend TypeScript code.

## Web3.js Version

SSS uses `@solana/web3.js 1.x` with Anchor. Use these imports:

```typescript
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
```

### Tree-shakable imports
```typescript
// BAD - imports entire library
import * as web3 from '@solana/web3.js';

// GOOD - tree-shakable
import { Connection, PublicKey } from '@solana/web3.js';
```

## Type Safety

### No `any` types
```typescript
// BAD
function process(data: any) { return data.value; }

// GOOD
interface StablecoinConfig {
  authority: PublicKey;
  mint: PublicKey;
  isPaused: boolean;
}
function process(data: StablecoinConfig): PublicKey { return data.authority; }
```

### Use BN for all on-chain numeric values
```typescript
// BAD - JavaScript number (unsafe for large values)
const amount = 1000000000;

// GOOD - BN for Solana u64
const amount = new BN(1_000_000_000);
```

### Explicit return types
```typescript
function derivePDA(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin"), mint.toBuffer()],
    programId
  );
}
```

## SDK Patterns

### PDA Derivation
```typescript
// Centralize PDA derivation in sdk/core/src/pda.ts
export function deriveConfigPDA(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin"), mint.toBuffer()],
    programId
  );
}

export function deriveRolePDA(
  config: PublicKey, roleType: number, user: PublicKey, programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("role"), config.toBuffer(), Buffer.from([roleType]), user.toBuffer()],
    programId
  );
}
```

### Error Handling
```typescript
// Catch and decode Anchor errors
try {
  await program.methods.mint(amount).accounts({...}).rpc();
} catch (e) {
  if (e instanceof AnchorError) {
    console.error(`Error ${e.error.errorCode.code}: ${e.error.errorMessage}`);
  }
  throw e;
}
```

### Transaction Patterns
```typescript
// Always use confirmed commitment
const provider = new AnchorProvider(connection, wallet, {
  commitment: "confirmed",
  preflightCommitment: "confirmed",
});
```

## Test Patterns

### Anchor Integration Tests
```typescript
describe("SSS-2 Compliance", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.Sss as Program<Sss>;

  it("blacklists address and blocks transfer", async () => {
    // Setup: grant blacklister role
    await program.methods
      .grantRole({ blacklister: {} })
      .accounts({ config, authority: authority.publicKey, user: blacklister.publicKey })
      .signers([authority])
      .rpc();

    // Blacklist target
    await program.methods
      .addToBlacklist(target.publicKey)
      .accounts({ config, blacklister: blacklister.publicKey })
      .signers([blacklister])
      .rpc();

    // Verify transfer blocked
    // ...
  });
});
```

### SDK Unit Tests
```typescript
import { describe, it, expect } from "vitest";

describe("PDA derivation", () => {
  it("derives config PDA correctly", () => {
    const [pda, bump] = deriveConfigPDA(mint, programId);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });
});
```

## Import Organization

```typescript
// 1. Node builtins
import * as fs from "fs";

// 2. External libraries
import { Connection, PublicKey } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";

// 3. Internal modules
import { deriveConfigPDA } from "./pda";
import { StablecoinSDK } from "./stablecoin";

// 4. Types (use import type)
import type { StablecoinConfig } from "./types";
```

## Code Style

- `camelCase` for functions and variables
- `PascalCase` for classes and interfaces
- `SCREAMING_SNAKE_CASE` for constants
- Use `const` over `let` where possible
- Prefer async/await over `.then()` chains
