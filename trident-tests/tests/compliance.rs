use proptest::prelude::*;
use sss_fuzz_tests::{
    ModelError, Operation, StablecoinModel, ROLE_BLACKLISTER, ROLE_MINTER, ROLE_SEIZER,
};

proptest! {
    #![proptest_config(ProptestConfig::with_cases(300))]

    #[test]
    fn blacklist_roundtrip_preserves_consistent_state(
        address in 1u8..8u8,
        reason_len in 0usize..=64usize,
    ) {
        let mut model = StablecoinModel::new_sss2(0);
        assert_eq!(
            model.apply(&Operation::UpdateRole {
                caller: 0,
                user: 2,
                role_type: ROLE_BLACKLISTER,
                active: true,
            }),
            Ok(())
        );

        assert_eq!(
            model.apply(&Operation::AddToBlacklist {
                caller: 2,
                address,
                reason_len,
            }),
            Ok(())
        );
        prop_assert!(model.blacklist.contains(&address));

        assert_eq!(
            model.apply(&Operation::RemoveFromBlacklist {
                caller: 2,
                address,
            }),
            Ok(())
        );
        prop_assert!(!model.blacklist.contains(&address));
        model.check_invariants();
    }

    #[test]
    fn seize_conserves_total_balances(
        minted in 1u64..=1_000_000u64,
        seized in 1u64..=1_000_000u64,
    ) {
        prop_assume!(seized <= minted);

        let mut model = StablecoinModel::new_sss2(0);
        assert_eq!(
            model.apply(&Operation::UpdateRole {
                caller: 0,
                user: 1,
                role_type: ROLE_MINTER,
                active: true,
            }),
            Ok(())
        );
        assert_eq!(
            model.apply(&Operation::UpdateRole {
                caller: 0,
                user: 3,
                role_type: ROLE_SEIZER,
                active: true,
            }),
            Ok(())
        );
        assert_eq!(
            model.apply(&Operation::CreateMinter {
                caller: 0,
                minter: 1,
                quota: minted,
            }),
            Ok(())
        );
        assert_eq!(
            model.apply(&Operation::Mint {
                minter: 1,
                amount: minted,
            }),
            Ok(())
        );

        let pre_total_balance: u64 = model.balances.values().copied().sum();
        assert_eq!(
            model.apply(&Operation::Seize {
                seizer: 3,
                from: 1,
                to: 4,
                amount: seized,
            }),
            Ok(())
        );
        let post_total_balance: u64 = model.balances.values().copied().sum();
        prop_assert_eq!(pre_total_balance, post_total_balance);
        model.check_invariants();
    }

    #[test]
    fn sss1_rejects_blacklist_and_seize_operations(
        address in 1u8..8u8,
        amount in 1u64..=100_000u64,
    ) {
        let mut model = StablecoinModel::new_sss1(0);

        assert_eq!(
            model.apply(&Operation::AddToBlacklist {
                caller: 1,
                address,
                reason_len: 10,
            }),
            Err(ModelError::ComplianceNotEnabled)
        );
        assert_eq!(
            model.apply(&Operation::Seize {
                seizer: 1,
                from: address,
                to: 2,
                amount,
            }),
            Err(ModelError::PermanentDelegateNotEnabled)
        );
        model.check_invariants();
    }
}
