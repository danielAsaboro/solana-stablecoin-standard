"use client";

import { useCallback, useRef } from "react";
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  Program,
  AnchorProvider,
  type Idl,
} from "@coral-xyz/anchor";
import {
  SolanaStablecoin,
  Presets,
  SSSEventParser,
  parseTransaction,
  type SSSEvent,
  type CreateStablecoinParams,
} from "@stbr/sss-core-sdk";
import { useSolanaWallet, useSolanaConnection } from "./usePrivySolana";
import { TRANSFER_HOOK_PROGRAM_ID, SSS_PROGRAM_ID } from "@/lib/constants";
import idlJson from "@/lib/idl.json";

export interface UseSDKReturn {
  ready: boolean;
  publicKey: PublicKey | null;
  sendInstructions: (
    ixs: TransactionInstruction[],
    extraSigners?: Keypair[]
  ) => Promise<string>;
  createStablecoin: (params: {
    name: string;
    symbol: string;
    uri?: string;
    decimals?: number;
    preset?: "SSS_1" | "SSS_2";
    transferHookProgramId?: PublicKey;
  }) => Promise<{
    stablecoin: SolanaStablecoin;
    mintAddress: PublicKey;
    signature: string;
  }>;
  loadStablecoin: (mint: PublicKey) => Promise<SolanaStablecoin>;
  parseEvents: (signature: string) => Promise<SSSEvent[]>;
}

export function useSDK(): UseSDKReturn {
  const { connection } = useSolanaConnection();
  const { publicKey, connected, signTransaction } = useSolanaWallet();

  const ready = connected && !!publicKey;

  const sendInstructions = useCallback(
    async (
      ixs: TransactionInstruction[],
      extraSigners: Keypair[] = []
    ): Promise<string> => {
      if (!publicKey || !signTransaction) {
        throw new Error("Wallet not connected");
      }

      const tx = new Transaction();
      for (const ix of ixs) {
        tx.add(ix);
      }

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;

      if (extraSigners.length > 0) {
        tx.partialSign(...extraSigners);
      }

      const signed = await signTransaction(tx);
      const rawTx = signed.serialize();
      const sig = await connection.sendRawTransaction(rawTx, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      return sig;
    },
    [connection, publicKey, signTransaction]
  );

  const createStablecoin = useCallback(
    async (params: {
      name: string;
      symbol: string;
      uri?: string;
      decimals?: number;
      preset?: "SSS_1" | "SSS_2";
      transferHookProgramId?: PublicKey;
    }) => {
      if (!publicKey) throw new Error("Wallet not connected");

      const preset =
        params.preset === "SSS_2"
          ? Presets.SSS_2
          : params.preset === "SSS_1"
            ? Presets.SSS_1
            : undefined;

      const createParams: CreateStablecoinParams = {
        name: params.name,
        symbol: params.symbol,
        uri: params.uri,
        decimals: params.decimals ?? 6,
        authority: publicKey,
        preset,
        transferHookProgramId:
          params.transferHookProgramId ??
          (params.preset === "SSS_2" ? TRANSFER_HOOK_PROGRAM_ID : undefined),
      };

      const { stablecoin, mintKeypair, instruction } =
        await SolanaStablecoin.create(connection, createParams);

      const signature = await sendInstructions(
        [instruction],
        [mintKeypair]
      );

      return {
        stablecoin,
        mintAddress: mintKeypair.publicKey,
        signature,
      };
    },
    [connection, publicKey, sendInstructions]
  );

  const loadStablecoin = useCallback(
    async (mint: PublicKey): Promise<SolanaStablecoin> => {
      return SolanaStablecoin.load(connection, mint);
    },
    [connection]
  );

  const programRef = useRef<Program | null>(null);

  const getProgram = useCallback((): Program => {
    if (programRef.current) return programRef.current;
    const dummyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any) => txs,
    };
    const provider = new AnchorProvider(
      connection,
      dummyWallet as any,
      { commitment: "confirmed" }
    );
    programRef.current = new Program(idlJson as Idl, provider);
    return programRef.current;
  }, [connection]);

  const parseEvents = useCallback(
    async (signature: string): Promise<SSSEvent[]> => {
      const program = getProgram();
      return parseTransaction(program, connection, signature);
    },
    [connection, getProgram]
  );

  return {
    ready,
    publicKey,
    sendInstructions,
    createStablecoin,
    loadStablecoin,
    parseEvents,
  };
}
