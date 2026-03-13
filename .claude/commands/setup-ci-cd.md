---
description: "Setup or update GitHub Actions CI/CD pipeline"
---

Configure CI/CD for the SSS project.

## Current CI Pipeline

The project uses `.github/workflows/ci.yml` covering:
- TypeScript compilation and tests
- Backend Rust tests
- Fuzz tests
- Anchor build + test
- Clippy linting

## CI Jobs

### 1. TypeScript
```yaml
- npm run build:packages
- npm run test:sdk
- npm run test:cli
```

### 2. Backend
```yaml
- cargo test --manifest-path backend/Cargo.toml
```

### 3. Fuzz
```yaml
- cd trident-tests && cargo test
```

### 4. Anchor
```yaml
- anchor build
- surfpool start --network mainnet --yes --legacy-anchor-compatibility &
- anchor test --skip-build
```

### 5. Clippy
```yaml
- cargo clippy --all-targets -- -D warnings
```

## Security Considerations

- Never store private keys in CI
- Use GitHub secrets for devnet deployment keys
- Pin action versions to specific SHAs
- Audit dependencies with `cargo audit`
