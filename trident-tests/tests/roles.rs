use proptest::prelude::*;
use sss_fuzz_tests::{
    ModelError, Operation, StablecoinModel, ROLE_BLACKLISTER, ROLE_MINTER, ROLE_SEIZER,
};

proptest! {
    #![proptest_config(ProptestConfig::with_cases(300))]

    #[test]
    fn authority_rotation_changes_admin_but_not_existing_roles(
        new_authority in 1u8..8u8,
        minter in 1u8..8u8,
        quota in 1u64..=1_000_000u64,
    ) {
        prop_assume!(new_authority != minter);

        let mut model = StablecoinModel::new_sss1(0);
        assert_eq!(
            model.apply(&Operation::UpdateRole {
                caller: 0,
                user: minter,
                role_type: ROLE_MINTER,
                active: true,
            }),
            Ok(())
        );
        assert_eq!(
            model.apply(&Operation::UpdateMinter {
                caller: 0,
                minter,
                quota,
            }),
            Ok(())
        );
        assert_eq!(
            model.apply(&Operation::TransferAuthority {
                caller: 0,
                new_authority,
            }),
            Ok(())
        );

        assert_eq!(
            model.apply(&Operation::UpdateRole {
                caller: 0,
                user: 7,
                role_type: ROLE_MINTER,
                active: true,
            }),
            Err(ModelError::InvalidAuthority)
        );

        let mint_result = model.apply(&Operation::Mint {
            minter,
            amount: 1,
        });
        prop_assert_eq!(mint_result, Ok(()));
        model.check_invariants();
    }

    #[test]
    fn sss1_rejects_compliance_roles_even_for_authority(
        role_type in prop_oneof![Just(ROLE_BLACKLISTER), Just(ROLE_SEIZER)],
        target in 1u8..8u8,
    ) {
        let mut model = StablecoinModel::new_sss1(0);
        let result = model.apply(&Operation::UpdateRole {
            caller: 0,
            user: target,
            role_type,
            active: true,
        });

        let expected = if role_type == ROLE_BLACKLISTER {
            ModelError::ComplianceNotEnabled
        } else {
            ModelError::PermanentDelegateNotEnabled
        };

        prop_assert_eq!(result, Err(expected));
        model.check_invariants();
    }
}
