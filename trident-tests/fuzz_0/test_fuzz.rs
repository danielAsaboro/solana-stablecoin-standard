/// # SSS Program Fuzz Tests — Trident / proptest Integration
///
/// This file documents the fuzz testing strategy for the SSS program.
/// The actual property-based tests live in `src/lib.rs` and use `proptest`
/// to generate thousands of random operation sequences.
///
/// ## Test Categories (13 property-based test suites)
///
/// | # | Test | Cases | What it verifies |
/// |---|------|-------|------------------|
/// | 1 | `fuzz_sss1_state_machine` | 1000 | Random 10-100 ops on SSS-1 model |
/// | 2 | `fuzz_sss2_state_machine` | 1000 | Random 10-100 ops on SSS-2 model |
/// | 3 | `fuzz_arithmetic_overflow_prevention` | 2000 | u64 boundary probing |
/// | 4 | `fuzz_quota_enforcement` | 2000 | Random quotas + mint sequences |
/// | 5 | `fuzz_access_control_rejection` | 1000 | Unauthorized caller rejection |
/// | 6 | `fuzz_pause_blocks_operations` | 1000 | Mint/burn blocked when paused |
/// | 7 | `fuzz_feature_gating` | 500 | SSS-2 ops fail on SSS-1 |
/// | 8 | `fuzz_blacklist_uniqueness` | 500 | No duplicate blacklist entries |
/// | 9 | `fuzz_authority_transfer_chain` | 500 | A→B→C authority chains |
/// | 10 | `fuzz_role_lifecycle` | 500 | Activate/deactivate/re-activate |
/// | 11 | `fuzz_seize_balance_conservation` | 500 | Token conservation on seize |
/// | 12 | `fuzz_zero_amount_rejection` | 200 | Zero amounts always rejected |
/// | 13 | `fuzz_stress_test_200_operations` | 100 | 200-op stress test |
///
/// Plus 7 deterministic invariant tests for specific edge cases.
///
/// ## Running
///
/// ```bash
/// # Run all fuzz tests (default: ~11,800 randomized test cases)
/// cd trident-tests && cargo test -- --nocapture
///
/// # Run with more cases per test
/// PROPTEST_CASES=10000 cargo test -- --nocapture
///
/// # Run a specific test
/// cargo test fuzz_arithmetic_overflow_prevention -- --nocapture
/// ```
///
/// ## Invariants Checked After Every Operation
///
/// 1. `total_minted >= total_burned`
/// 2. No u64 overflow in any counter
/// 3. `minter.minted <= minter.quota` for successful mints
/// 4. Mint and burn blocked when `paused == true`
/// 5. Only users with active roles can execute role-gated operations
/// 6. SSS-2 ops fail when compliance features are disabled
/// 7. Cannot blacklist the same address twice
/// 8. Only master authority can manage roles/quotas/authority
/// 9. Operation count consistency (attempted = succeeded + failed)
///
/// ## Architecture
///
/// The [`StablecoinModel`](sss_fuzz_tests::StablecoinModel) is a pure-Rust
/// state machine that mirrors the on-chain program's logic:
///
/// - Same validation rules (zero amount, pause checks, role checks)
/// - Same checked arithmetic (checked_add for all counters)
/// - Same feature gating (SSS-1 vs SSS-2)
/// - Same error types (modeled as [`ModelError`](sss_fuzz_tests::ModelError))
///
/// The `proptest` framework generates random [`Operation`](sss_fuzz_tests::Operation)
/// sequences with boundary-biased amounts (0, 1, u64::MAX) and applies them
/// to the model, checking all invariants after every state transition.
