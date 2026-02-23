# Testing Guide

Comprehensive testing documentation for the Solana Stablecoin Standard (SSS).

## Test Pyramid

```
                ┌─────────────────┐
                │   Fuzz Tests    │  21 tests (~11,800 cases)
                │  (Property-Based)│  Pure-Rust state machine
                └────────┬────────┘
                ┌────────┴────────┐
                │  Integration    │  96 tests
                │  (Anchor/Solana)│  On-chain program + SDK
                └────────┬────────┘
           ┌─────────────┴─────────────┐
           │   Backend Integration     │  53 tests
           │   (Axum HTTP + Services)  │  Routes, services, webhooks
           └───────────────────────────┘
```

**Total: 170 tests** (96 Anchor + 53 Backend + 21 Fuzz)

---

## Quick Start

```bash
# Run all Anchor integration tests (starts local validator automatically)
anchor test --skip-lint

# Run backend integration tests
cd backend && cargo test

# Run fuzz/property tests
cd trident-tests && cargo test

# Build everything (verify no compilation errors)
anchor build && yarn build
```

> **Important**: Always use `anchor test --skip-lint` for integration tests. This starts
> a fresh `solana-test-validator` with all programs deployed. Never test against devnet.

---

## Test Categories

### 1. Anchor Integration Tests (96 tests)

Located in `tests/`. Run with `anchor test --skip-lint`.

#### SSS-1 Preset — `tests/sss-1.ts` (13 tests)

Core SSS-1 lifecycle covering all 10 instructions:

| Test | Description |
|------|-------------|
| creates an SSS-1 stablecoin | Initialize, verify config PDA, check Token-2022 metadata |
| assigns Minter role | Update roles, verify RoleAccount PDA |
| assigns Burner role | Update roles, verify PDA |
| assigns Pauser role | Update roles, verify PDA |
| sets minter quota | Update minter quota, verify MinterQuota PDA |
| mints tokens to recipient | Mint, verify supply, check quota tracking |
| freezes a token account | Freeze via Token-2022, verify account state |
| thaws a frozen token account | Thaw, verify account restored |
| pauses the stablecoin | Set paused=true, verify config |
| blocks minting when paused | Mint while paused → Paused error |
| unpauses the stablecoin | Unpause, verify config |
| burns tokens | Burn, verify supply decreases, total_burned increments |
| transfers master authority | TransferAuthority, verify new authority controls config |

#### SSS-2 Preset — `tests/sss-2.ts` (8 tests)

Compliance-specific instructions on top of SSS-1:

| Test | Description |
|------|-------------|
| creates stablecoin with permanent delegate and transfer hook | Init with both SSS-2 flags, verify mint extensions |
| assigns all 5 role types | All roles including Blacklister (3) and Seizer (4) |
| sets minter quota | Quota for SSS-2 minter |
| initializes extra account metas for the transfer hook | Hook ExtraAccountMetas PDA creation |
| mints tokens | Mint through SSS-2 config |
| blacklists an address | Add BlacklistEntry PDA, verify on-chain state |
| removes from blacklist | Close BlacklistEntry, verify rent returned |
| seizes tokens from an account using permanent delegate | Seize via config PDA permanent delegate |

#### Role Management — `tests/roles.ts` (6 tests)

| Test | Description |
|------|-------------|
| assigns all SSS-1 role types | All three SSS-1 roles in one test |
| revokes a role | Deactivate role, verify blocked |
| rejects unauthorized role assignment | Non-authority role assign → ConstraintHasOne |
| rejects SSS-2 roles on SSS-1 config | Blacklister/Seizer on SSS-1 → ComplianceNotEnabled |
| multiple users can hold the same role concurrently | Two users each with Burner role, independent PDAs |
| assigns SSS-2 compliance roles on SSS-2 config | Blacklister (3) + Seizer (4) valid on SSS-2 |

#### Token Transfers — `tests/transfers.ts` (11 tests)

Transfer behavior with freeze and blacklist enforcement:

| Test | Description |
|------|-------------|
| transfers tokens between users via transfer_checked | Basic transfer flow |
| Alice transfers tokens to Bob | Named transfer, verify balances |
| frozen account cannot send tokens | Frozen sender → Token error |
| frozen account cannot receive tokens | Frozen receiver → Token error |
| thawed account can transfer again | Thaw restores transfer capability |
| transfer succeeds with transfer hook resolved | Transfer on SSS-2 with extra account metas |
| transfer between non-blacklisted users succeeds | Hook passes for clean addresses |
| blacklisted sender cannot transfer | Hook rejects blacklisted sender |
| blacklisted receiver cannot receive transfers | Hook rejects blacklisted receiver |
| un-blacklisted user can transfer again | After removal, transfers succeed |
| seize tokens from blacklisted account | Permanent delegate bypasses hook |

#### Seize Operations — `tests/seize.ts` (4 tests)

| Test | Description |
|------|-------------|
| seizes tokens to treasury | Full seize flow, verify balances |
| rejects zero amount seize | Zero seize → ZeroAmount error |
| rejects seize by non-Seizer | Attacker without Seizer role → account not found |
| seizes full remaining balance | Seize all tokens, verify zero balance |

#### Multi-Minter — `tests/multi-minter.ts` (2 tests)

| Test | Description |
|------|-------------|
| minters have independent quotas | Two minters, independent quota tracking |
| quota can be reset by updating | Update quota resets cumulative counter |

#### Transfer Hook — `tests/transfer-hook.ts` (1 test)

| Test | Description |
|------|-------------|
| initializes the extra account metas PDA | Hook program ExtraAccountMetas creation |

#### Edge Case Tests — `tests/edge-cases.ts` (20 tests)

Boundary conditions and error paths:

| Section | Tests | Description |
|---------|-------|-------------|
| Input Validation | 3 | Max name/symbol length, invalid decimals (>9) |
| Zero Amounts | 2 | Zero mint rejected, zero burn rejected |
| Overflow Protection | 2 | Quota exceeded, cumulative u64 overflow → MathOverflow |
| Pause Guards | 4 | Double-pause, unpause-when-not-paused, burn/freeze while paused |
| Role Self-Revocation | 2 | Self-revoke minter role, verify mint blocked after |
| Invalid Roles | 1 | Role type >4 → InvalidRole |
| Authority Protection | 2 | Transfer to same address, non-authority transfer attempt |
| Feature Gating | 1 | SSS-2 operations on SSS-1 config → FeatureNotEnabled |
| Duplicate Blacklist | 1 | Double-add same address → Anchor init constraint failure |
| Blacklist Validation | 1 | Reason exceeding MAX_REASON_LEN → ReasonTooLong |
| Non-Existent Entry | 1 | Remove non-blacklisted address → account not found |

#### Authority Rotation Tests — `tests/authority-rotation.ts` (31 tests)

Full authority lifecycle covering A→B→C→A chain transfers:

| Stage | Tests | Description |
|-------|-------|-------------|
| Transfer Authority | 2 | A→B transfer, config verification |
| Old Authority Blocked | 3 | Old authority cannot update_roles, update_minter, transfer_authority |
| Role Persistence | 4 | Old minter/burner/pauser roles still work (by design) |
| Role Revocation | 6 | New authority revokes old roles, verifies operations blocked |
| New Authority Control | 6 | New authority exercises full admin: roles, quotas, mint, burn, freeze, pause |
| Chain Transfer | 4 | B→C transfer, C grants roles, C→A return |
| SSS-2 Compliance | 6 | Authority rotation with blacklist, seize, transfer hook resolution |

### 2. Backend Integration Tests (53 tests)

Located in `backend/tests/integration_tests.rs`. Run with `cd backend && cargo test`.

Uses `tower::ServiceExt::oneshot` for HTTP request testing and `wiremock` for webhook delivery verification.

| Section | Tests | Description |
|---------|-------|-------------|
| Health Endpoint | 3 | Returns OK, reports service status, webhooks always available |
| Webhook CRUD | 8 | Register, reject invalid URLs, list, get, delete, not-found |
| Webhook Dispatch | 6 | Delivery verification, HMAC signatures, event filtering, retry behavior |
| Service Unavailable (503) | 13 | All Solana-dependent routes gracefully return 503 without config |
| PDA Derivation | 6 | Determinism, uniqueness per role/user, all PDA types |
| Instruction Builders | 5 | Mint/burn/blacklist instruction structure, Anchor discriminators |
| Input Validation | 4 | Pubkey parsing (valid, invalid, empty), keypair loading |
| Webhook Service Unit | 5 | Register, list, unregister, not-found, delivery log |
| Solana Context | 2 | Config PDA derivation, stored fields |

### 3. Property-Based Fuzz Tests (21 tests)

Located in `trident-tests/`. Run with `cd trident-tests && cargo test`.

Uses [proptest](https://crates.io/crates/proptest) 1.4 with a pure-Rust `StablecoinModel` state machine that mirrors all on-chain program logic. Each test generates hundreds to thousands of randomized operation sequences and verifies 9 invariants after every operation.

#### Fuzz Test Inventory

| Test | Cases | Description |
|------|-------|-------------|
| `fuzz_sss1_state_machine` | 1,000 | 10-100 random operations on SSS-1 model |
| `fuzz_sss2_state_machine` | 1,000 | 10-100 random operations on SSS-2 model |
| `fuzz_arithmetic_overflow_prevention` | 2,000 | u64 boundary probing with MAX values |
| `fuzz_quota_enforcement` | 2,000 | Random quotas + mint sequences |
| `fuzz_access_control_rejection` | 1,000 | Unauthorized callers for all 5 role types |
| `fuzz_pause_blocks_operations` | 1,000 | Mint/burn blocked when paused |
| `fuzz_feature_gating` | 500 | SSS-2 operations fail on SSS-1 config |
| `fuzz_blacklist_uniqueness` | 500 | Duplicate entry prevention |
| `fuzz_authority_transfer_chain` | 500 | A→B→C authority transfer chains |
| `fuzz_role_lifecycle` | 500 | Activate/deactivate/re-activate cycles |
| `fuzz_input_validation` | 500 | Boundary validation for all input types |
| `fuzz_seize_balance_conservation` | 500 | Token balance conservation on seize operations |
| `fuzz_stress_test_200_operations` | 100 | 200-operation stress test per case |

**Total: ~11,800 randomized test cases**

#### Deterministic Unit Tests (8 tests within the fuzz suite)

- Double-initialize rejection
- Mint-burn lifecycle with supply tracking
- Quota persistence across updates
- Pause/unpause state guards
- Full SSS-2 compliance flow (blacklist + seize)
- Max u64 overflow prevention
- Role self-revocation
- Authority transfer chain validation

#### Invariants Verified

After every operation in every fuzz test, these 9 invariants are checked:

1. **Supply Conservation**: `total_minted - total_burned == net_supply` (no tokens created or destroyed outside mint/burn)
2. **Quota Consistency**: `minted <= quota` for every minter at all times
3. **Feature Gating**: SSS-2 operations (blacklist, seize) are impossible on SSS-1 configs
4. **Pause Enforcement**: Mint, burn, freeze, thaw all blocked when paused
5. **Role Requirements**: Each operation requires the correct active role
6. **Blacklist Uniqueness**: No duplicate blacklist entries
7. **Authority Exclusivity**: Only the current master authority can perform admin operations
8. **Arithmetic Safety**: No operation causes u64 overflow or underflow
9. **State Consistency**: Config fields remain consistent across operations

---

## Test Helpers

### Anchor Test Helpers (`tests/`)

Each test file imports from the Anchor workspace and creates dedicated keypairs for isolation:

```typescript
const minterKeypair = anchor.web3.Keypair.generate();
const burnerKeypair = anchor.web3.Keypair.generate();

// Fund accounts on local validator
await provider.connection.requestAirdrop(minterKeypair.publicKey, LAMPORTS_PER_SOL);

// PDA derivation
const [rolePDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("role"), configPDA.toBuffer(), Buffer.from([roleType]), user.toBuffer()],
  program.programId
);
```

### Backend Test Helpers (`backend/tests/`)

```rust
/// Create a test application with no Solana context (degraded mode).
fn test_app() -> Router {
    let state = AppState {
        mint_burn: None,
        compliance: None,
        indexer: None,
        webhook: Arc::new(WebhookService::new()),
    };
    build_router(state)
}

/// Send a POST request with JSON body and return parsed response.
async fn post_json<T: Serialize>(app: &Router, path: &str, body: &T) -> Response {
    let req = Request::builder()
        .uri(path)
        .method("POST")
        .header("content-type", "application/json")
        .body(Body::from(serde_json::to_string(body).unwrap()))
        .unwrap();
    ServiceExt::oneshot(app.clone(), req).await.unwrap()
}
```

### Fuzz Test Model (`trident-tests/src/lib.rs`)

```rust
/// Pure-Rust model of the on-chain StablecoinConfig.
struct StablecoinModel {
    initialized: bool,
    paused: bool,
    master_authority: u8,  // simplified to u8 ID
    total_minted: u64,
    total_burned: u64,
    roles: HashMap<(u8, u8), bool>,   // (user_id, role_type) → active
    quotas: HashMap<u8, (u64, u64)>,  // user_id → (minted, quota)
    blacklist: HashSet<u8>,
    enable_transfer_hook: bool,
    enable_permanent_delegate: bool,
}
```

---

## Running Specific Test Files

```bash
# Run only edge case tests
anchor test --skip-lint -- --grep "Edge Cases"

# Run only authority rotation tests
anchor test --skip-lint -- --grep "Authority Rotation"

# Run a specific backend test
cd backend && cargo test test_health_endpoint

# Run a specific fuzz test
cd trident-tests && cargo test fuzz_sss1_state_machine

# Run fuzz tests with more output
cd trident-tests && cargo test -- --nocapture
```

---

## Coverage Summary

| Category | Files | Tests | Cases | Coverage |
|----------|-------|-------|-------|----------|
| Anchor Integration | 9 | 96 | 96 | All 13 instructions, both presets, all error paths |
| Backend Integration | 1 | 53 | 53 | All HTTP routes, services, webhooks, PDA derivation |
| Property-Based Fuzz | 1 | 21 | ~11,800 | State machine model, overflow, access control, invariants |
| **Total** | **11** | **170** | **~11,949** | **Full instruction + error + boundary coverage** |

All tests pass with zero warnings on `anchor build`, `yarn build`, `cargo build`, and `cargo clippy`.
