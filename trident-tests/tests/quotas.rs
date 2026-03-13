use proptest::prelude::*;
use sss_fuzz_tests::{ModelError, Operation, StablecoinModel, ROLE_MINTER};

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    #[test]
    fn lowering_quota_preserves_minted_history_and_blocks_future_mints(
        first_mint in 1u64..=1_000_000u64,
        quota_reduction in 0u64..=500_000u64,
        next_mint in 1u64..=1_000_000u64,
    ) {
        let mut model = StablecoinModel::new_sss1(0);
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
            model.apply(&Operation::UpdateMinter {
                caller: 0,
                minter: 1,
                quota: first_mint + quota_reduction,
            }),
            Ok(())
        );
        assert_eq!(
            model.apply(&Operation::Mint {
                minter: 1,
                amount: first_mint,
            }),
            Ok(())
        );

        let lowered_quota = first_mint.saturating_sub(quota_reduction);
        assert_eq!(
            model.apply(&Operation::UpdateMinter {
                caller: 0,
                minter: 1,
                quota: lowered_quota,
            }),
            Ok(())
        );

        let current_minted = model.minter_quotas.get(&1).map(|(_, minted)| *minted).unwrap_or(0);
        prop_assert_eq!(current_minted, first_mint);

        let mint_result = model.apply(&Operation::Mint {
            minter: 1,
            amount: next_mint,
        });
        prop_assert_eq!(mint_result, Err(ModelError::QuotaExceeded));
        model.check_invariants();
    }

    #[test]
    fn quota_updates_for_one_minter_do_not_change_another_minters_usage(
        quota_a in 1u64..=2_000_000u64,
        quota_b in 1u64..=2_000_000u64,
        minted_a in 1u64..=500_000u64,
    ) {
        prop_assume!(minted_a <= quota_a);

        let mut model = StablecoinModel::new_sss1(0);
        for minter in [1u8, 2u8] {
            assert_eq!(
                model.apply(&Operation::UpdateRole {
                    caller: 0,
                    user: minter,
                    role_type: ROLE_MINTER,
                    active: true,
                }),
                Ok(())
            );
        }

        assert_eq!(
            model.apply(&Operation::UpdateMinter {
                caller: 0,
                minter: 1,
                quota: quota_a,
            }),
            Ok(())
        );
        assert_eq!(
            model.apply(&Operation::UpdateMinter {
                caller: 0,
                minter: 2,
                quota: quota_b,
            }),
            Ok(())
        );
        assert_eq!(
            model.apply(&Operation::Mint {
                minter: 1,
                amount: minted_a,
            }),
            Ok(())
        );

        assert_eq!(
            model.apply(&Operation::UpdateMinter {
                caller: 0,
                minter: 2,
                quota: quota_b.saturating_add(1),
            }),
            Ok(())
        );

        let minted_for_a = model.minter_quotas.get(&1).map(|(_, minted)| *minted).unwrap_or(0);
        let minted_for_b = model.minter_quotas.get(&2).map(|(_, minted)| *minted).unwrap_or(0);
        prop_assert_eq!(minted_for_a, minted_a);
        prop_assert_eq!(minted_for_b, 0);
        model.check_invariants();
    }
}
