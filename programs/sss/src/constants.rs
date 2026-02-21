pub const STABLECOIN_SEED: &[u8] = b"stablecoin";
pub const ROLE_SEED: &[u8] = b"role";
pub const MINTER_QUOTA_SEED: &[u8] = b"minter_quota";
pub const BLACKLIST_SEED: &[u8] = b"blacklist";

pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 200;
pub const MAX_REASON_LEN: usize = 64;

pub const ROLE_MINTER: u8 = 0;
pub const ROLE_BURNER: u8 = 1;
pub const ROLE_PAUSER: u8 = 2;
pub const ROLE_BLACKLISTER: u8 = 3;
pub const ROLE_SEIZER: u8 = 4;
