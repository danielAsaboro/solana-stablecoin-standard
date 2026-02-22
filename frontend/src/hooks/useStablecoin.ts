"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  Program,
  AnchorProvider,
  BN,
  type Idl,
} from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import idlJson from "@/lib/idl.json";
import { SSS_PROGRAM_ID, SEEDS, ROLE_TYPES } from "@/lib/constants";

// ---------------------------------------------------------------------------
// PDA derivation helpers
// ---------------------------------------------------------------------------

function getConfigAddress(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEEDS.STABLECOIN), mint.toBuffer()],
    SSS_PROGRAM_ID
  );
}

function getRoleAddress(
  config: PublicKey,
  roleType: number,
  user: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEEDS.ROLE),
      config.toBuffer(),
      Buffer.from([roleType]),
      user.toBuffer(),
    ],
    SSS_PROGRAM_ID
  );
}

function getMinterQuotaAddress(
  config: PublicKey,
  minter: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEEDS.MINTER_QUOTA),
      config.toBuffer(),
      minter.toBuffer(),
    ],
    SSS_PROGRAM_ID
  );
}

function getBlacklistEntryAddress(
  config: PublicKey,
  address: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(SEEDS.BLACKLIST),
      config.toBuffer(),
      address.toBuffer(),
    ],
    SSS_PROGRAM_ID
  );
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StablecoinConfigData {
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
  decimals: number;
  masterAuthority: PublicKey;
  enablePermanentDelegate: boolean;
  enableTransferHook: boolean;
  defaultAccountFrozen: boolean;
  paused: boolean;
  totalMinted: BN;
  totalBurned: BN;
  transferHookProgram: PublicKey;
  bump: number;
}

export interface RoleAccountData {
  config: PublicKey;
  user: PublicKey;
  roleType: number;
  active: boolean;
  bump: number;
}

export interface MinterQuotaData {
  config: PublicKey;
  minter: PublicKey;
  quota: BN;
  minted: BN;
  bump: number;
}

export interface BlacklistEntryData {
  config: PublicKey;
  address: PublicKey;
  reason: string;
  blacklistedAt: BN;
  blacklistedBy: PublicKey;
  bump: number;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseStablecoinResult {
  /** Whether the program is ready to use */
  ready: boolean;
  /** The Anchor program instance */
  program: Program | null;
  /** Currently loaded config */
  config: StablecoinConfigData | null;
  /** Config PDA address */
  configAddress: PublicKey | null;
  /** Mint address */
  mintAddress: PublicKey | null;
  /** Loading state */
  loading: boolean;
  /** Last error */
  error: string | null;

  // Actions
  loadStablecoin: (mint: string) => Promise<void>;
  refreshConfig: () => Promise<void>;
  mintTokens: (recipient: string, amount: string) => Promise<string>;
  burnTokens: (fromAccount: string, amount: string) => Promise<string>;
  freezeAccount: (wallet: string) => Promise<string>;
  thawAccount: (wallet: string) => Promise<string>;
  pauseStablecoin: () => Promise<string>;
  unpauseStablecoin: () => Promise<string>;
  updateRole: (
    roleType: number,
    user: string,
    active: boolean
  ) => Promise<string>;
  updateMinterQuota: (minter: string, quota: string) => Promise<string>;
  addToBlacklist: (address: string, reason: string) => Promise<string>;
  removeFromBlacklist: (address: string) => Promise<string>;

  // Read
  fetchRoles: () => Promise<RoleAccountData[]>;
  fetchMinterQuotas: () => Promise<MinterQuotaData[]>;
  fetchBlacklist: () => Promise<BlacklistEntryData[]>;
  fetchSupply: () => Promise<string>;
}

export function useStablecoin(): UseStablecoinResult {
  const { connection } = useConnection();
  const wallet = useWallet();

  const [program, setProgram] = useState<Program | null>(null);
  const [config, setConfig] = useState<StablecoinConfigData | null>(null);
  const [configAddress, setConfigAddress] = useState<PublicKey | null>(null);
  const [mintAddress, setMintAddress] = useState<PublicKey | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize the Anchor program when wallet connects
  useEffect(() => {
    if (!wallet.publicKey || !wallet.signTransaction) {
      setProgram(null);
      return;
    }

    const provider = new AnchorProvider(
      connection,
      {
        publicKey: wallet.publicKey,
        signTransaction: wallet.signTransaction.bind(wallet),
        signAllTransactions: wallet.signAllTransactions?.bind(wallet) ?? (async (txs) => txs),
      },
      { commitment: "confirmed" }
    );

    const prog = new Program(idlJson as Idl, provider);
    setProgram(prog);
  }, [connection, wallet.publicKey, wallet.signTransaction, wallet.signAllTransactions]);

  // Helper to send + confirm a transaction
  const sendTx = useCallback(
    async (tx: Transaction): Promise<string> => {
      if (!wallet.publicKey || !wallet.signTransaction) {
        throw new Error("Wallet not connected");
      }
      tx.feePayer = wallet.publicKey;
      tx.recentBlockhash = (
        await connection.getLatestBlockhash()
      ).blockhash;
      const signed = await wallet.signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction(sig, "confirmed");
      return sig;
    },
    [connection, wallet]
  );

  // Load a stablecoin by mint address
  const loadStablecoin = useCallback(
    async (mintStr: string) => {
      if (!program) throw new Error("Program not ready");
      setLoading(true);
      setError(null);
      try {
        const mint = new PublicKey(mintStr);
        const [cfgAddr] = getConfigAddress(mint);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cfgData = await (program.account as any).stablecoinConfig.fetch(
          cfgAddr
        );
        setMintAddress(mint);
        setConfigAddress(cfgAddr);
        setConfig(cfgData as StablecoinConfigData);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [program]
  );

  // Refresh the current config
  const refreshConfig = useCallback(async () => {
    if (!program || !configAddress) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cfgData = await (program.account as any).stablecoinConfig.fetch(
        configAddress
      );
      setConfig(cfgData as StablecoinConfigData);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [program, configAddress]);

  // Mint tokens
  const mintTokens = useCallback(
    async (recipientWallet: string, amount: string): Promise<string> => {
      if (!program || !configAddress || !mintAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const recipient = new PublicKey(recipientWallet);
      const recipientAta = getAssociatedTokenAddressSync(
        mintAddress,
        recipient,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const [roleAccount] = getRoleAddress(
        configAddress,
        ROLE_TYPES.Minter,
        wallet.publicKey
      );
      const [minterQuota] = getMinterQuotaAddress(
        configAddress,
        wallet.publicKey
      );

      const ix = await program.methods
        .mintTokens(new BN(amount))
        .accountsStrict({
          minter: wallet.publicKey,
          config: configAddress,
          roleAccount,
          minterQuota,
          mint: mintAddress,
          recipientTokenAccount: recipientAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      const sig = await sendTx(tx);
      await refreshConfig();
      return sig;
    },
    [program, configAddress, mintAddress, wallet.publicKey, sendTx, refreshConfig]
  );

  // Burn tokens
  const burnTokens = useCallback(
    async (fromAccount: string, amount: string): Promise<string> => {
      if (!program || !configAddress || !mintAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const from = new PublicKey(fromAccount);
      const [roleAccount] = getRoleAddress(
        configAddress,
        ROLE_TYPES.Burner,
        wallet.publicKey
      );

      const ix = await program.methods
        .burnTokens(new BN(amount))
        .accountsStrict({
          burner: wallet.publicKey,
          config: configAddress,
          roleAccount,
          mint: mintAddress,
          fromTokenAccount: from,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      const sig = await sendTx(tx);
      await refreshConfig();
      return sig;
    },
    [program, configAddress, mintAddress, wallet.publicKey, sendTx, refreshConfig]
  );

  // Freeze account
  const freezeAccount = useCallback(
    async (walletAddr: string): Promise<string> => {
      if (!program || !configAddress || !mintAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const target = new PublicKey(walletAddr);
      const tokenAccount = getAssociatedTokenAddressSync(
        mintAddress,
        target,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const [roleAccount] = getRoleAddress(
        configAddress,
        ROLE_TYPES.Pauser,
        wallet.publicKey
      );

      const ix = await program.methods
        .freezeTokenAccount()
        .accountsStrict({
          authority: wallet.publicKey,
          config: configAddress,
          roleAccount,
          mint: mintAddress,
          tokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      return sendTx(tx);
    },
    [program, configAddress, mintAddress, wallet.publicKey, sendTx]
  );

  // Thaw account
  const thawAccount = useCallback(
    async (walletAddr: string): Promise<string> => {
      if (!program || !configAddress || !mintAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const target = new PublicKey(walletAddr);
      const tokenAccount = getAssociatedTokenAddressSync(
        mintAddress,
        target,
        false,
        TOKEN_2022_PROGRAM_ID
      );
      const [roleAccount] = getRoleAddress(
        configAddress,
        ROLE_TYPES.Pauser,
        wallet.publicKey
      );

      const ix = await program.methods
        .thawTokenAccount()
        .accountsStrict({
          authority: wallet.publicKey,
          config: configAddress,
          roleAccount,
          mint: mintAddress,
          tokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      return sendTx(tx);
    },
    [program, configAddress, mintAddress, wallet.publicKey, sendTx]
  );

  // Pause
  const pauseStablecoin = useCallback(async (): Promise<string> => {
    if (!program || !configAddress || !wallet.publicKey)
      throw new Error("Not ready");

    const [roleAccount] = getRoleAddress(
      configAddress,
      ROLE_TYPES.Pauser,
      wallet.publicKey
    );

    const ix = await program.methods
      .pause()
      .accountsStrict({
        authority: wallet.publicKey,
        config: configAddress,
        roleAccount,
      })
      .instruction();

    const tx = new Transaction().add(ix);
    const sig = await sendTx(tx);
    await refreshConfig();
    return sig;
  }, [program, configAddress, wallet.publicKey, sendTx, refreshConfig]);

  // Unpause
  const unpauseStablecoin = useCallback(async (): Promise<string> => {
    if (!program || !configAddress || !wallet.publicKey)
      throw new Error("Not ready");

    const [roleAccount] = getRoleAddress(
      configAddress,
      ROLE_TYPES.Pauser,
      wallet.publicKey
    );

    const ix = await program.methods
      .unpause()
      .accountsStrict({
        authority: wallet.publicKey,
        config: configAddress,
        roleAccount,
      })
      .instruction();

    const tx = new Transaction().add(ix);
    const sig = await sendTx(tx);
    await refreshConfig();
    return sig;
  }, [program, configAddress, wallet.publicKey, sendTx, refreshConfig]);

  // Update role
  const updateRole = useCallback(
    async (
      roleType: number,
      user: string,
      active: boolean
    ): Promise<string> => {
      if (!program || !configAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const userPk = new PublicKey(user);
      const [roleAccount] = getRoleAddress(configAddress, roleType, userPk);

      const ix = await program.methods
        .updateRoles(roleType, userPk, active)
        .accountsStrict({
          authority: wallet.publicKey,
          config: configAddress,
          roleAccount,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      return sendTx(tx);
    },
    [program, configAddress, wallet.publicKey, sendTx]
  );

  // Update minter quota
  const updateMinterQuota = useCallback(
    async (minter: string, quota: string): Promise<string> => {
      if (!program || !configAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const minterPk = new PublicKey(minter);
      const [minterQuota] = getMinterQuotaAddress(configAddress, minterPk);

      const ix = await program.methods
        .updateMinter(minterPk, new BN(quota))
        .accountsStrict({
          authority: wallet.publicKey,
          config: configAddress,
          minterQuota,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      return sendTx(tx);
    },
    [program, configAddress, wallet.publicKey, sendTx]
  );

  // Add to blacklist
  const addToBlacklist = useCallback(
    async (address: string, reason: string): Promise<string> => {
      if (!program || !configAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const addr = new PublicKey(address);
      const [roleAccount] = getRoleAddress(
        configAddress,
        ROLE_TYPES.Blacklister,
        wallet.publicKey
      );
      const [blacklistEntry] = getBlacklistEntryAddress(configAddress, addr);

      const ix = await program.methods
        .addToBlacklist(addr, reason)
        .accountsStrict({
          authority: wallet.publicKey,
          config: configAddress,
          roleAccount,
          blacklistEntry,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      return sendTx(tx);
    },
    [program, configAddress, wallet.publicKey, sendTx]
  );

  // Remove from blacklist
  const removeFromBlacklist = useCallback(
    async (address: string): Promise<string> => {
      if (!program || !configAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const addr = new PublicKey(address);
      const [roleAccount] = getRoleAddress(
        configAddress,
        ROLE_TYPES.Blacklister,
        wallet.publicKey
      );
      const [blacklistEntry] = getBlacklistEntryAddress(configAddress, addr);

      const ix = await program.methods
        .removeFromBlacklist(addr)
        .accountsStrict({
          authority: wallet.publicKey,
          config: configAddress,
          roleAccount,
          blacklistEntry,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      return sendTx(tx);
    },
    [program, configAddress, wallet.publicKey, sendTx]
  );

  // Fetch all roles for this stablecoin
  const fetchRoles = useCallback(async (): Promise<RoleAccountData[]> => {
    if (!program || !configAddress) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await (program.account as any).roleAccount.all([
      {
        memcmp: {
          offset: 8,
          bytes: configAddress.toBase58(),
        },
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return accounts.map((a: any) => a.account as RoleAccountData);
  }, [program, configAddress]);

  // Fetch all minter quotas
  const fetchMinterQuotas = useCallback(async (): Promise<MinterQuotaData[]> => {
    if (!program || !configAddress) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await (program.account as any).minterQuota.all([
      {
        memcmp: {
          offset: 8,
          bytes: configAddress.toBase58(),
        },
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return accounts.map((a: any) => a.account as MinterQuotaData);
  }, [program, configAddress]);

  // Fetch all blacklist entries
  const fetchBlacklist = useCallback(async (): Promise<BlacklistEntryData[]> => {
    if (!program || !configAddress) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const accounts = await (program.account as any).blacklistEntry.all([
      {
        memcmp: {
          offset: 8,
          bytes: configAddress.toBase58(),
        },
      },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return accounts.map((a: any) => a.account as BlacklistEntryData);
  }, [program, configAddress]);

  // Fetch actual supply from mint
  const fetchSupply = useCallback(async (): Promise<string> => {
    if (!mintAddress) return "0";
    const supply = await connection.getTokenSupply(mintAddress);
    return supply.value.amount;
  }, [connection, mintAddress]);

  return {
    ready: !!program,
    program,
    config,
    configAddress,
    mintAddress,
    loading,
    error,
    loadStablecoin,
    refreshConfig,
    mintTokens,
    burnTokens,
    freezeAccount,
    thawAccount,
    pauseStablecoin,
    unpauseStablecoin,
    updateRole,
    updateMinterQuota,
    addToBlacklist,
    removeFromBlacklist,
    fetchRoles,
    fetchMinterQuotas,
    fetchBlacklist,
    fetchSupply,
  };
}
