---
description: "Run Rust tests across all test suites"
---

Run the full Rust test suite covering programs, backend, and fuzz tests.

## Test Suites

### 1. Backend Tests
```bash
cargo test --manifest-path backend/Cargo.toml
```
Expected: 53 tests passing

### 2. Fuzz Tests
```bash
cd trident-tests && cargo test
```
Expected: 21 tests (~11,800 cases)

### 3. Program Unit Tests (if any)
```bash
cargo test --workspace --exclude sss-backend
```

## Troubleshooting

- **Compilation errors**: Run `anchor build` first to generate IDLs
- **Backend test failures**: Check that test fixtures match current program state
- **Fuzz test timeouts**: Increase timeout or reduce iteration count

## Post-Test
Report total tests passed/failed. If any fail, investigate and fix before committing.
