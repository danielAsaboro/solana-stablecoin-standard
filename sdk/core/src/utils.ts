import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";

// ---------------------------------------------------------------------------
// Token-2022 helper utilities
// ---------------------------------------------------------------------------

/** The Token-2022 program ID re-exported for convenience. */
export { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";

/**
 * Derive the associated token account (ATA) address for a given mint and owner
 * using the Token-2022 program.
 *
 * @param mint  - The Token-2022 mint pubkey
 * @param owner - The wallet/owner pubkey
 * @returns The ATA address
 */
export function getAssociatedTokenAddress(
  mint: PublicKey,
  owner: PublicKey
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    owner,
    true, // allowOwnerOffCurve
    TOKEN_2022_PROGRAM_ID
  );
}

/**
 * Build an instruction to create an associated token account (idempotent)
 * for the Token-2022 program.
 *
 * @param payer - The account paying for rent
 * @param owner - The owner of the new token account
 * @param mint  - The Token-2022 mint
 * @returns A TransactionInstruction
 */
export function createATAInstruction(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey
): TransactionInstruction {
  return createAssociatedTokenAccountIdempotentInstruction(
    payer,
    getAssociatedTokenAddress(mint, owner),
    owner,
    mint,
    TOKEN_2022_PROGRAM_ID
  );
}

/**
 * Fetch the token balance of an associated token account.
 *
 * @param connection - Solana RPC connection
 * @param mint       - The Token-2022 mint
 * @param owner      - The wallet owner
 * @returns The token balance as a number (UI amount), or 0 if the account
 *          does not exist.
 */
export async function getTokenBalance(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey
): Promise<number> {
  const ata = getAssociatedTokenAddress(mint, owner);
  try {
    const info = await connection.getTokenAccountBalance(ata);
    return info.value.uiAmount ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Fetch the current total supply of a Token-2022 mint.
 *
 * @param connection - Solana RPC connection
 * @param mint       - The Token-2022 mint pubkey
 * @returns The supply as a bigint-style string, decimals, and uiAmount
 */
export async function getMintSupply(
  connection: Connection,
  mint: PublicKey
): Promise<{ amount: string; decimals: number; uiAmount: number | null }> {
  const info = await connection.getTokenSupply(mint);
  return {
    amount: info.value.amount,
    decimals: info.value.decimals,
    uiAmount: info.value.uiAmount,
  };
}

/**
 * Check if a given account exists on-chain.
 *
 * @param connection - Solana RPC connection
 * @param address    - The account pubkey to check
 * @returns true if the account exists and has data
 */
export async function accountExists(
  connection: Connection,
  address: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(address);
  return info !== null;
}
