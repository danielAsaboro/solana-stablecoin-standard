---
description: "Build Solana programs with Anchor"
---

Build and verify all Solana programs in the workspace.

## Steps

1. **Identify programs**
```bash
ls programs/
cat Anchor.toml
```

2. **Build all programs**
```bash
anchor build
```

3. **Verify build artifacts**
```bash
ls -la target/deploy/*.so
```

4. **Check IDL generation**
```bash
ls target/idl/
```

5. **Verify program sizes**
```bash
for so in target/deploy/*.so; do
  echo "$(basename $so): $(wc -c < $so) bytes"
done
```

Programs must be under 1.4MB (BPF loader limit). If oversized, check for unnecessary dependencies.

6. **Build with specific features** (if needed)
```bash
anchor build -p sss -- --features modules
```
