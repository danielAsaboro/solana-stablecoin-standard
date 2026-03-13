# IDLs + Client Generation

## Goal
Never hand-maintain multiple program clients. Use IDL-driven, code-generated workflow.

## Anchor IDL Generation

SSS programs use Anchor, which generates IDLs automatically:

```bash
anchor build
# IDLs generated at:
# target/idl/sss.json
# target/idl/transfer_hook.json
# target/idl/oracle.json
# target/idl/privacy.json
```

## TypeScript Client (Anchor)

Anchor generates TypeScript types automatically:
```typescript
import { Program } from "@coral-xyz/anchor";
import { Sss } from "../target/types/sss";

const program = anchor.workspace.Sss as Program<Sss>;

// Type-safe instruction calls
await program.methods
  .initialize(params)
  .accounts({ ... })
  .rpc();

// Type-safe account fetching
const config = await program.account.stablecoinConfig.fetch(configPda);
```

## Codama (Kit-native)

For `@solana/kit` clients:
```bash
npx codama generate --idl target/idl/sss.json --out src/generated
```

## IDL Structure
```json
{
  "version": "0.1.0",
  "name": "sss",
  "instructions": [...],
  "accounts": [...],
  "types": [...],
  "events": [...],
  "errors": [...]
}
```

## Do Not
- Write IDLs by hand
- Hand-write Borsh layouts for programs you own
- Maintain separate serialization logic in SDK
