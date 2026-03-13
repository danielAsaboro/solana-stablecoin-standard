---
description: "Iterative test and fix loop until all tests pass"
---

Run tests, identify failures, fix them, and repeat until green.

## Process

1. **Run the failing test suite**
Identify which suite is failing and run it:
```bash
anchor test --skip-build        # Anchor integration
npm run test:sdk                # SDK unit tests
npm run test:cli                # CLI smoke tests
cargo test --manifest-path backend/Cargo.toml  # Backend
```

2. **Analyze failures**
- Read the error message carefully
- Check if it's a test issue or a program issue
- For Anchor errors, decode the error code against `SSSError` enum

3. **Fix the root cause**
- Program bugs: Fix in `programs/` and rebuild with `anchor build`
- Test bugs: Fix in `tests/` or `sdk/*/src/tests/`
- SDK bugs: Fix in `sdk/` and rebuild with `npm run build:packages`

4. **Re-run and verify**
Run the specific failing test first, then the full suite:
```bash
anchor test --skip-build -- --grep "failing test name"
anchor test --skip-build  # full suite
```

5. **Repeat until green**

## Common Fix Patterns

| Error | Likely Cause | Fix |
|-------|-------------|-----|
| `AccountNotFound` | PDA seeds wrong | Check seed derivation |
| `InstructionFallbackNotFound` | Missing fallback handler | Add fallback fn for transfer hook |
| `BlockhashExpired` | Slow validator | Use confirmed commitment |
| `QuotaExceeded` | Minter quota too low | Reset quota before test |
