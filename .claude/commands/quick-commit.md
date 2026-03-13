---
description: "Quick commit with formatting, linting, and conventional commit message"
---

Automate the commit process with pre-commit quality checks.

## Steps

1. **Check for changes**
```bash
git status
git diff --stat
```

2. **Format code**
```bash
cargo fmt --all
npx prettier --write "**/*.{ts,tsx,js,jsx,json}" 2>/dev/null || true
```

3. **Lint**
```bash
cargo clippy --all-targets -- -D warnings
```

4. **Stage changes**
Stage only the relevant files. Never stage `.env`, `.surfpool/`, or `CRITICAL_EVALUATION.md`.

5. **Generate commit message**
Use conventional commit format:
```
<type>(<scope>): <description>

[optional body]
```

Types: `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `security`
Scopes: `sss`, `hook`, `oracle`, `privacy`, `sdk`, `cli`, `backend`, `frontend`, `tui`, `ci`

6. **Commit**
```bash
git commit -m "<message>"
```
