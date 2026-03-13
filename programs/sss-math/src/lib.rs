//! # SSS Math — Shared Arithmetic Utilities
//!
//! A pure Rust library providing checked and saturating arithmetic helpers used
//! across the Solana Stablecoin Standard program suite. All operations are
//! overflow-safe: functions that can overflow return `Option<u64>` and callers
//! are expected to map `None` to an appropriate on-chain error.
//!
//! ## Design principles
//!
//! - **No panics** — every operation that could overflow returns `Option`.
//! - **u128 intermediates** — `mul_div` and `mul_div_ceil` widen to `u128` for
//!   the multiplication step, avoiding phantom overflow before the division.
//! - **Basis-point fees** — `apply_bps_fee` uses `mul_div` under the hood so
//!   the fee is computed precisely without loss from integer truncation order.
//! - **Supply helpers** — `current_supply` and `supply_remaining` centralise the
//!   arithmetic used by minting gates across multiple programs.

/// 100% expressed in basis points. One BPS = 0.01%.
pub const MAX_BPS: u16 = 10_000;

// ── Basic checked arithmetic ──────────────────────────────────────────────────

/// Add two `u64` values, returning `None` on overflow.
#[inline(always)]
pub fn checked_add(a: u64, b: u64) -> Option<u64> {
    a.checked_add(b)
}

/// Subtract `b` from `a`, returning `None` if the result would underflow.
#[inline(always)]
pub fn checked_sub(a: u64, b: u64) -> Option<u64> {
    a.checked_sub(b)
}

/// Multiply two `u64` values, returning `None` on overflow.
#[inline(always)]
pub fn checked_mul(a: u64, b: u64) -> Option<u64> {
    a.checked_mul(b)
}

// ── Scaled arithmetic ─────────────────────────────────────────────────────────

/// Compute `floor(a * b / c)` using a `u128` intermediate to avoid overflow in
/// the multiplication step.
///
/// Returns `None` if:
/// - `c` is zero (division by zero).
/// - The final result does not fit in a `u64`.
pub fn mul_div(a: u64, b: u64, c: u64) -> Option<u64> {
    if c == 0 {
        return None;
    }
    let numerator = (a as u128).checked_mul(b as u128)?;
    let result = numerator / (c as u128);
    if result > u64::MAX as u128 {
        None
    } else {
        Some(result as u64)
    }
}

/// Compute `ceil(a * b / c)` using a `u128` intermediate to avoid overflow in
/// the multiplication step.
///
/// Returns `None` if:
/// - `c` is zero (division by zero).
/// - The final result does not fit in a `u64`.
pub fn mul_div_ceil(a: u64, b: u64, c: u64) -> Option<u64> {
    if c == 0 {
        return None;
    }
    let numerator = (a as u128).checked_mul(b as u128)?;
    let c128 = c as u128;
    // ceiling division: (numerator + c - 1) / c
    let ceil_numerator = numerator.checked_add(c128 - 1)?;
    let result = ceil_numerator / c128;
    if result > u64::MAX as u128 {
        None
    } else {
        Some(result as u64)
    }
}

// ── Fee helpers ───────────────────────────────────────────────────────────────

/// Compute the fee for `amount` at a rate of `fee_bps` basis points.
///
/// The result is `floor(amount * fee_bps / 10_000)`.
///
/// Returns `None` if the intermediate multiplication overflows `u128` (extremely
/// unlikely given `u64` inputs) or if `fee_bps` exceeds [`MAX_BPS`].
pub fn apply_bps_fee(amount: u64, fee_bps: u16) -> Option<u64> {
    if fee_bps > MAX_BPS {
        return None;
    }
    mul_div(amount, fee_bps as u64, MAX_BPS as u64)
}

// ── Supply helpers ────────────────────────────────────────────────────────────

/// Compute the current circulating supply as `total_minted - total_burned`.
///
/// Returns `None` if `total_burned > total_minted` (which would indicate
/// corrupted on-chain state and should be treated as a fatal error).
pub fn current_supply(total_minted: u64, total_burned: u64) -> Option<u64> {
    total_minted.checked_sub(total_burned)
}

/// Compute how many more tokens can be minted before hitting the supply cap.
///
/// - If `supply_cap == 0` the cap is **unlimited** and `u64::MAX` is returned.
/// - Otherwise returns `supply_cap.saturating_sub(total_minted)`.
///
/// Saturating subtraction is intentional: if the program ever somehow minted
/// beyond the cap (e.g., due to a bug), this returns `0` rather than wrapping.
pub fn supply_remaining(supply_cap: u64, total_minted: u64) -> u64 {
    if supply_cap == 0 {
        u64::MAX
    } else {
        supply_cap.saturating_sub(total_minted)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // checked_add
    #[test]
    fn test_checked_add_basic() {
        assert_eq!(checked_add(10, 20), Some(30));
    }

    #[test]
    fn test_checked_add_overflow() {
        assert_eq!(checked_add(u64::MAX, 1), None);
    }

    #[test]
    fn test_checked_add_zero() {
        assert_eq!(checked_add(0, 0), Some(0));
    }

    // checked_sub
    #[test]
    fn test_checked_sub_basic() {
        assert_eq!(checked_sub(30, 10), Some(20));
    }

    #[test]
    fn test_checked_sub_underflow() {
        assert_eq!(checked_sub(5, 10), None);
    }

    #[test]
    fn test_checked_sub_equal() {
        assert_eq!(checked_sub(42, 42), Some(0));
    }

    // checked_mul
    #[test]
    fn test_checked_mul_basic() {
        assert_eq!(checked_mul(6, 7), Some(42));
    }

    #[test]
    fn test_checked_mul_overflow() {
        assert_eq!(checked_mul(u64::MAX, 2), None);
    }

    #[test]
    fn test_checked_mul_zero() {
        assert_eq!(checked_mul(u64::MAX, 0), Some(0));
    }

    // mul_div
    #[test]
    fn test_mul_div_basic() {
        // 10 * 3 / 5 = 6
        assert_eq!(mul_div(10, 3, 5), Some(6));
    }

    #[test]
    fn test_mul_div_floor() {
        // 10 * 1 / 3 = 3 (floor)
        assert_eq!(mul_div(10, 1, 3), Some(3));
    }

    #[test]
    fn test_mul_div_zero_divisor() {
        assert_eq!(mul_div(10, 5, 0), None);
    }

    #[test]
    fn test_mul_div_large_values() {
        // u64::MAX * 1 / 1 = u64::MAX
        assert_eq!(mul_div(u64::MAX, 1, 1), Some(u64::MAX));
    }

    #[test]
    fn test_mul_div_result_overflow() {
        // u64::MAX * 2 / 1 would overflow u64
        assert_eq!(mul_div(u64::MAX, 2, 1), None);
    }

    // mul_div_ceil
    #[test]
    fn test_mul_div_ceil_exact() {
        // 10 * 3 / 5 = 6 exactly — ceil == floor
        assert_eq!(mul_div_ceil(10, 3, 5), Some(6));
    }

    #[test]
    fn test_mul_div_ceil_rounds_up() {
        // 10 * 1 / 3 = 3.33... ceil = 4
        assert_eq!(mul_div_ceil(10, 1, 3), Some(4));
    }

    #[test]
    fn test_mul_div_ceil_zero_divisor() {
        assert_eq!(mul_div_ceil(10, 5, 0), None);
    }

    // apply_bps_fee
    #[test]
    fn test_apply_bps_fee_basic() {
        // 1_000_000 tokens * 50 bps = 5_000
        assert_eq!(apply_bps_fee(1_000_000, 50), Some(5_000));
    }

    #[test]
    fn test_apply_bps_fee_zero_fee() {
        assert_eq!(apply_bps_fee(1_000_000, 0), Some(0));
    }

    #[test]
    fn test_apply_bps_fee_max_bps() {
        // 100% fee — result equals the full amount
        assert_eq!(apply_bps_fee(1_000, MAX_BPS), Some(1_000));
    }

    #[test]
    fn test_apply_bps_fee_exceeds_max_bps() {
        // fee_bps > 10_000 is invalid
        assert_eq!(apply_bps_fee(1_000, MAX_BPS + 1), None);
    }

    #[test]
    fn test_apply_bps_fee_zero_amount() {
        assert_eq!(apply_bps_fee(0, 500), Some(0));
    }

    // current_supply
    #[test]
    fn test_current_supply_basic() {
        assert_eq!(current_supply(1_000, 400), Some(600));
    }

    #[test]
    fn test_current_supply_zero_burned() {
        assert_eq!(current_supply(500, 0), Some(500));
    }

    #[test]
    fn test_current_supply_equal() {
        // all minted tokens have been burned
        assert_eq!(current_supply(1_000, 1_000), Some(0));
    }

    #[test]
    fn test_current_supply_underflow() {
        // burned > minted — invalid state returns None
        assert_eq!(current_supply(100, 200), None);
    }

    // supply_remaining
    #[test]
    fn test_supply_remaining_unlimited() {
        // cap == 0 means unlimited
        assert_eq!(supply_remaining(0, 0), u64::MAX);
        assert_eq!(supply_remaining(0, 999_999), u64::MAX);
    }

    #[test]
    fn test_supply_remaining_basic() {
        assert_eq!(supply_remaining(1_000, 400), 600);
    }

    #[test]
    fn test_supply_remaining_at_cap() {
        assert_eq!(supply_remaining(1_000, 1_000), 0);
    }

    #[test]
    fn test_supply_remaining_saturates() {
        // minted > cap saturates to 0, not a wrap
        assert_eq!(supply_remaining(1_000, 1_500), 0);
    }
}
