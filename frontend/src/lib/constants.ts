import { PublicKey } from "@solana/web3.js";

/** SSS program ID (localnet) */
export const SSS_PROGRAM_ID = new PublicKey(
  "DNfk1e2vMJrxHm4BwoRTVqQxcfYjZLHggxr11hMZ5Dyu"
);

/** Transfer hook program ID (localnet) */
export const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  "Gcd58Ng9gqRg1XtiU1i8KopwX1u82Mt9VmxKbLJ8RANH"
);

/** RPC endpoint — defaults to localnet */
export const RPC_ENDPOINT =
  process.env.NEXT_PUBLIC_RPC_URL || "http://127.0.0.1:8899";

/** Role type constants */
export const ROLE_TYPES = {
  Minter: 0,
  Burner: 1,
  Pauser: 2,
  Blacklister: 3,
  Seizer: 4,
} as const;

/** Role type labels */
export const ROLE_LABELS: Record<number, string> = {
  0: "Minter",
  1: "Burner",
  2: "Pauser",
  3: "Blacklister",
  4: "Seizer",
};

/** PDA seed constants */
export const SEEDS = {
  STABLECOIN: "stablecoin",
  ROLE: "role",
  MINTER_QUOTA: "minter_quota",
  BLACKLIST: "blacklist",
} as const;

/** Truncate a public key for display */
export function truncateAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/** Format token amounts with decimals */
export function formatTokenAmount(
  amount: bigint | number | string,
  decimals: number
): string {
  const raw = BigInt(amount.toString());
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const remainder = raw % divisor;
  const remainderStr = remainder.toString().padStart(decimals, "0");

  if (decimals === 0) return whole.toLocaleString();

  const trimmed = remainderStr.replace(/0+$/, "");
  if (trimmed === "") return whole.toLocaleString();
  return `${whole.toLocaleString()}.${trimmed}`;
}
