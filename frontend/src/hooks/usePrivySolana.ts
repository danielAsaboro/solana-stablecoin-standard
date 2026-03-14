"use client";

import { useCallback, useMemo } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useSolanaWallets, useSignTransaction } from "@privy-io/react-auth/solana";
import { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useSolanaConnection as useSolanaConnectionCtx } from "@/contexts/ConnectionContext";

export function useSolanaConnection() {
  return useSolanaConnectionCtx();
}

/**
 * Drop-in replacement for `useWallet()` from @solana/wallet-adapter-react.
 * Returns the same interface shape so useStablecoin.ts works unchanged.
 */
export function useSolanaWallet() {
  const { wallets: allWallets } = useWallets();
  const { wallets: solanaWallets } = useSolanaWallets();
  const { signTransaction: privySignTransaction } = useSignTransaction();
  const { connection } = useSolanaConnectionCtx();

  // Prefer Solana embedded wallets, fall back to any connected wallet
  const wallet = solanaWallets[0] ?? allWallets.find((w) => w.walletClientType === "privy");
  const publicKey = useMemo(
    () => (wallet ? new PublicKey(wallet.address) : null),
    [wallet]
  );

  const signTransaction = useCallback(
    async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (!wallet) throw new Error("No Solana wallet connected");

      // Privy's useSignTransaction takes the Transaction object directly + connection
      const signed = await privySignTransaction({
        transaction: tx,
        connection,
      });

      return signed as T;
    },
    [wallet, privySignTransaction, connection]
  );

  const signAllTransactions = useCallback(
    async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      return Promise.all(txs.map((tx) => signTransaction(tx)));
    },
    [signTransaction]
  );

  return {
    publicKey,
    connected: !!wallet,
    signTransaction,
    signAllTransactions,
    wallet,
  };
}

/**
 * Wrapper around Privy login/logout for UI components.
 */
export function usePrivyLogin() {
  const { login, logout, authenticated, ready, user } = usePrivy();
  return { login, logout, authenticated, ready, user };
}
