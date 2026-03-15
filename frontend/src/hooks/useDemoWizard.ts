"use client";

import { useCallback, useReducer, useRef } from "react";
import {
  Keypair,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { BN, type Idl, Program, AnchorProvider } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import {
  SolanaStablecoin,
  Presets,
  RoleType,
  type SSSEvent,
  getConfigAddress,
  getExtraAccountMetasAddress,
} from "@stbr/sss-core-sdk";
import { useSDK } from "./useSDK";
import { useSolanaConnection } from "./usePrivySolana";
import { SSS_PROGRAM_ID, TRANSFER_HOOK_PROGRAM_ID } from "@/lib/constants";
import hookIdlJson from "@/lib/hookIdl.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StepStatus = "pending" | "running" | "success" | "error" | "skipped";

export interface DemoStep {
  id: string;
  title: string;
  description: string;
  codeSnippet: string;
  status: StepStatus;
  result?: string;
  signature?: string;
  events?: SSSEvent[];
  error?: string;
  onChain: boolean;
}

export interface DemoState {
  steps: DemoStep[];
  currentStepIndex: number;
  stablecoin: SolanaStablecoin | null;
  mintAddress: PublicKey | null;
  alice: Keypair;
  bob: Keypair;
  victim: Keypair;
  treasury: Keypair;
  signatures: string[];
}

type DemoAction =
  | { type: "SET_STEP_STATUS"; index: number; status: StepStatus; result?: string; signature?: string; events?: SSSEvent[]; error?: string }
  | { type: "ADVANCE" }
  | { type: "SET_STABLECOIN"; stablecoin: SolanaStablecoin; mintAddress: PublicKey }
  | { type: "ADD_SIGNATURE"; signature: string }
  | { type: "RESET" };

// ---------------------------------------------------------------------------
// Initial step definitions
// ---------------------------------------------------------------------------

function makeSteps(): DemoStep[] {
  return [
    {
      id: "initialize",
      title: "1. Create SSS-2 Stablecoin",
      description:
        "Create a new SSS-2 compliant stablecoin with permanent delegate and transfer hook enabled. This is the foundation for the enforcement scenario.",
      codeSnippet: `const { stablecoin, mintKeypair, instruction } =
  await SolanaStablecoin.create(connection, {
    preset: Presets.SSS_2,
    name: "Demo USD",
    symbol: "DUSD",
    decimals: 6,
    authority: wallet.publicKey,
    transferHookProgramId: TRANSFER_HOOK_PROGRAM_ID,
  });`,
      status: "pending",
      onChain: true,
    },
    {
      id: "assign-roles",
      title: "2. Assign Roles & Set Quota",
      description:
        "Assign Minter, Burner, Pauser, Blacklister, and Seizer roles to the connected wallet. Set the minter quota to 100M tokens.",
      codeSnippet: `// Assign all 5 roles to the authority
for (const role of [Minter, Burner, Pauser, Blacklister, Seizer]) {
  await stablecoin.assignRole({ roleType: role, user: authority, authority });
}
// Set minter quota
await stablecoin.updateMinter({ minter: authority, quota: 100_000_000 });`,
      status: "pending",
      onChain: true,
    },
    {
      id: "init-hook",
      title: "3. Initialize Transfer Hook",
      description:
        "Initialize the ExtraAccountMetaList for the transfer hook program. This enables blacklist checking on every token transfer.",
      codeSnippet: `await hookProgram.methods.initializeExtraAccountMetaList()
  .accounts({ mint, extraAccountMetaList, authority, systemProgram })
  .rpc();`,
      status: "pending",
      onChain: true,
    },
    {
      id: "mint-tokens",
      title: "4. Mint to Alice & Bob",
      description:
        "Mint 10M DUSD to Alice and 5M DUSD to Bob. Total supply becomes 15M DUSD.",
      codeSnippet: `await stablecoin.mint(10_000_000e6).to(alice).by(authority).send();
await stablecoin.mint(5_000_000e6).to(bob).by(authority).send();`,
      status: "pending",
      onChain: true,
    },
    {
      id: "verify-supply",
      title: "5. Verify Supply = 15M DUSD",
      description:
        "Read the on-chain supply and individual balances to confirm the mint operations were successful.",
      codeSnippet: `const supply = await stablecoin.getSupply();
// supply.uiAmount === 15_000_000`,
      status: "pending",
      onChain: false,
    },
    {
      id: "blacklist-bob",
      title: "6. Blacklist Bob",
      description:
        'The FBI has traced stolen funds to Bob\'s wallet. Add Bob to the on-chain blacklist with a compliance reason. From this point, Bob cannot send or receive DUSD.',
      codeSnippet: `await stablecoin.compliance.blacklistAdd(bob, "FBI Case #2024-1847")
  .by(blacklister)
  .send();`,
      status: "pending",
      onChain: true,
    },
    {
      id: "show-blocked",
      title: "7. Transfer Blocked",
      description:
        "Verify that Bob is blacklisted and that any transfer involving Bob's address will be rejected by the transfer hook.",
      codeSnippet: `const isBlacklisted = await stablecoin.compliance.isBlacklisted(bob);
// isBlacklisted === true
// Any transfer to/from bob will fail with "Blacklisted"`,
      status: "pending",
      onChain: false,
    },
    {
      id: "seize-tokens",
      title: "8. Seize Bob's Tokens",
      description:
        "Using the permanent delegate authority, seize all 5M DUSD from Bob's wallet and transfer them to the treasury.",
      codeSnippet: `await stablecoin.compliance.seize(5_000_000e6)
  .from(bob)
  .to(treasury)
  .by(seizer)
  .send();`,
      status: "pending",
      onChain: true,
    },
    {
      id: "burn-remint",
      title: "9. Burn & Remint to Victim",
      description:
        "Burn the seized tokens from treasury and remint clean tokens to the original victim. Supply stays constant at 15M.",
      codeSnippet: `await stablecoin.burn(5_000_000e6).from(treasuryAta).by(burner).send();
await stablecoin.mint(5_000_000e6).to(victim).by(minter).send();`,
      status: "pending",
      onChain: true,
    },
    {
      id: "final-audit",
      title: "10. Verify Supply + Audit Trail",
      description:
        "Verify the total supply is still 15M DUSD and review the complete audit trail from on-chain events.",
      codeSnippet: `const finalSupply = await stablecoin.getSupply();
// finalSupply.uiAmount === 15_000_000
const events = await parser.parseTransaction(connection, sig);`,
      status: "pending",
      onChain: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function createInitialState(): DemoState {
  return {
    steps: makeSteps(),
    currentStepIndex: 0,
    stablecoin: null,
    mintAddress: null,
    alice: Keypair.generate(),
    bob: Keypair.generate(),
    victim: Keypair.generate(),
    treasury: Keypair.generate(),
    signatures: [],
  };
}

function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "SET_STEP_STATUS": {
      const steps = [...state.steps];
      steps[action.index] = {
        ...steps[action.index],
        status: action.status,
        result: action.result ?? steps[action.index].result,
        signature: action.signature ?? steps[action.index].signature,
        events: action.events ?? steps[action.index].events,
        error: action.error,
      };
      return { ...state, steps };
    }
    case "ADVANCE":
      return { ...state, currentStepIndex: state.currentStepIndex + 1 };
    case "SET_STABLECOIN":
      return { ...state, stablecoin: action.stablecoin, mintAddress: action.mintAddress };
    case "ADD_SIGNATURE":
      return { ...state, signatures: [...state.signatures, action.signature] };
    case "RESET":
      return createInitialState();
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useDemoWizard() {
  const [state, dispatch] = useReducer(reducer, null, createInitialState);
  const { connection } = useSolanaConnection();
  const sdk = useSDK();
  const runningRef = useRef(false);

  const executeStep = useCallback(
    async (stepIndex: number) => {
      if (runningRef.current) return;
      runningRef.current = true;

      dispatch({ type: "SET_STEP_STATUS", index: stepIndex, status: "running" });

      try {
        switch (state.steps[stepIndex].id) {
          case "initialize":
            await executeInitialize();
            break;
          case "assign-roles":
            await executeAssignRoles();
            break;
          case "init-hook":
            await executeInitHook();
            break;
          case "mint-tokens":
            await executeMintTokens();
            break;
          case "verify-supply":
            await executeVerifySupply();
            break;
          case "blacklist-bob":
            await executeBlacklistBob();
            break;
          case "show-blocked":
            await executeShowBlocked();
            break;
          case "seize-tokens":
            await executeSeizeTokens();
            break;
          case "burn-remint":
            await executeBurnRemint();
            break;
          case "final-audit":
            await executeFinalAudit();
            break;
        }
      } catch (err) {
        dispatch({
          type: "SET_STEP_STATUS",
          index: stepIndex,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        runningRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, sdk, connection]
  );

  // --- Step implementations ---

  async function executeInitialize() {
    if (!sdk.publicKey) throw new Error("Wallet not connected");

    const { stablecoin, mintAddress, signature } = await sdk.createStablecoin({
      name: "Demo USD",
      symbol: "DUSD",
      decimals: 6,
      preset: "SSS_2",
      transferHookProgramId: TRANSFER_HOOK_PROGRAM_ID,
    });

    dispatch({ type: "SET_STABLECOIN", stablecoin, mintAddress });
    dispatch({ type: "ADD_SIGNATURE", signature });

    const events = await sdk.parseEvents(signature);
    dispatch({
      type: "SET_STEP_STATUS",
      index: 0,
      status: "success",
      result: `Mint: ${mintAddress.toBase58()}`,
      signature,
      events,
    });
  }

  async function executeAssignRoles() {
    if (!state.stablecoin || !sdk.publicKey) throw new Error("Initialize first");

    const stablecoin = state.stablecoin;
    const authority = sdk.publicKey;

    // Assign all 5 roles
    const roleIxs: TransactionInstruction[] = [];
    for (const roleType of [
      RoleType.Minter,
      RoleType.Burner,
      RoleType.Pauser,
      RoleType.Blacklister,
      RoleType.Seizer,
    ]) {
      const ixArr = await stablecoin
        .assignRole(roleType, authority)
        .by(authority)
        .instruction();
      roleIxs.push(...ixArr);
    }
    const sig1 = await sdk.sendInstructions(roleIxs);
    dispatch({ type: "ADD_SIGNATURE", signature: sig1 });

    // Set minter quota
    const quotaIxArr = await stablecoin
      .updateMinter(authority)
      .quota(new BN("100000000000000")) // 100M * 1e6
      .instruction();
    const sig2 = await sdk.sendInstructions(quotaIxArr);
    dispatch({ type: "ADD_SIGNATURE", signature: sig2 });

    dispatch({
      type: "SET_STEP_STATUS",
      index: 1,
      status: "success",
      result: "5 roles assigned, minter quota set to 100M",
      signature: sig1,
    });
  }

  async function executeInitHook() {
    if (!state.mintAddress || !sdk.publicKey) throw new Error("Initialize first");

    const mint = state.mintAddress;
    const authority = sdk.publicKey;

    const [extraAccountMetaList] = getExtraAccountMetasAddress(
      TRANSFER_HOOK_PROGRAM_ID,
      mint
    );

    // Build the hook program from IDL
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
    const hookProgram = new Program(hookIdlJson as Idl, provider);

    const ix = await hookProgram.methods
      .initializeExtraAccountMetaList()
      .accountsStrict({
        mint,
        extraAccountMetaList,
        authority,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const sig = await sdk.sendInstructions([ix]);
    dispatch({ type: "ADD_SIGNATURE", signature: sig });

    dispatch({
      type: "SET_STEP_STATUS",
      index: 2,
      status: "success",
      result: `ExtraAccountMetaList initialized`,
      signature: sig,
    });
  }

  async function executeMintTokens() {
    if (!state.stablecoin || !state.mintAddress || !sdk.publicKey)
      throw new Error("Initialize first");

    const stablecoin = state.stablecoin;
    const authority = sdk.publicKey;
    const mint = state.mintAddress;

    // Create ATAs for alice and bob, then mint
    const aliceAta = getAssociatedTokenAddressSync(
      mint, state.alice.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const bobAta = getAssociatedTokenAddressSync(
      mint, state.bob.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Mint to Alice: 10M DUSD
    const createAliceAta = createAssociatedTokenAccountInstruction(
      authority, aliceAta, state.alice.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const mintAliceIx = await stablecoin.mint({
      amount: new BN("10000000000000"), // 10M * 1e6
      recipientTokenAccount: aliceAta,
      minter: authority,
    });
    const sig1 = await sdk.sendInstructions([createAliceAta, mintAliceIx]);
    dispatch({ type: "ADD_SIGNATURE", signature: sig1 });

    // Mint to Bob: 5M DUSD
    const createBobAta = createAssociatedTokenAccountInstruction(
      authority, bobAta, state.bob.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const mintBobIx = await stablecoin.mint({
      amount: new BN("5000000000000"), // 5M * 1e6
      recipientTokenAccount: bobAta,
      minter: authority,
    });
    const sig2 = await sdk.sendInstructions([createBobAta, mintBobIx]);
    dispatch({ type: "ADD_SIGNATURE", signature: sig2 });

    dispatch({
      type: "SET_STEP_STATUS",
      index: 3,
      status: "success",
      result: `Minted 10M DUSD to Alice, 5M DUSD to Bob`,
      signature: sig1,
    });
  }

  async function executeVerifySupply() {
    if (!state.stablecoin || !state.mintAddress) throw new Error("Initialize first");

    const supply = await state.stablecoin.getSupply();
    const aliceAta = getAssociatedTokenAddressSync(
      state.mintAddress, state.alice.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const bobAta = getAssociatedTokenAddressSync(
      state.mintAddress, state.bob.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const [aliceBal, bobBal] = await Promise.all([
      connection.getTokenAccountBalance(aliceAta, "confirmed"),
      connection.getTokenAccountBalance(bobAta, "confirmed"),
    ]);

    dispatch({
      type: "SET_STEP_STATUS",
      index: 4,
      status: "success",
      result: `Supply: ${supply.uiAmount?.toLocaleString()} DUSD | Alice: ${aliceBal.value.uiAmountString} | Bob: ${bobBal.value.uiAmountString}`,
    });
  }

  async function executeBlacklistBob() {
    if (!state.stablecoin || !sdk.publicKey) throw new Error("Initialize first");

    const ixArr = await state.stablecoin.compliance
      .blacklistAdd(state.bob.publicKey, "FBI Case #2024-1847")
      .by(sdk.publicKey)
      .instruction();

    const sig = await sdk.sendInstructions(ixArr);
    dispatch({ type: "ADD_SIGNATURE", signature: sig });

    const events = await sdk.parseEvents(sig);
    dispatch({
      type: "SET_STEP_STATUS",
      index: 5,
      status: "success",
      result: `Bob blacklisted: ${state.bob.publicKey.toBase58().slice(0, 8)}...`,
      signature: sig,
      events,
    });
  }

  async function executeShowBlocked() {
    if (!state.stablecoin) throw new Error("Initialize first");

    const isBlacklisted = await state.stablecoin.compliance.isBlacklisted(
      state.bob.publicKey
    );

    dispatch({
      type: "SET_STEP_STATUS",
      index: 6,
      status: "success",
      result: `Bob blacklisted: ${isBlacklisted}. Any transfer to/from Bob will be rejected by the transfer hook.`,
    });
  }

  async function executeSeizeTokens() {
    if (!state.stablecoin || !state.mintAddress || !sdk.publicKey)
      throw new Error("Initialize first");

    const treasuryAta = getAssociatedTokenAddressSync(
      state.mintAddress, state.treasury.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const createTreasuryAta = createAssociatedTokenAccountInstruction(
      sdk.publicKey, treasuryAta, state.treasury.publicKey, state.mintAddress, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );

    const seizeIxArr = await state.stablecoin.compliance
      .seize(new BN("5000000000000"))
      .from(state.bob.publicKey)
      .to(state.treasury.publicKey)
      .by(sdk.publicKey)
      .instruction();

    const sig = await sdk.sendInstructions([createTreasuryAta, ...seizeIxArr]);
    dispatch({ type: "ADD_SIGNATURE", signature: sig });

    const events = await sdk.parseEvents(sig);
    dispatch({
      type: "SET_STEP_STATUS",
      index: 7,
      status: "success",
      result: `Seized 5M DUSD from Bob to treasury`,
      signature: sig,
      events,
    });
  }

  async function executeBurnRemint() {
    if (!state.stablecoin || !state.mintAddress || !sdk.publicKey)
      throw new Error("Initialize first");

    const treasuryAta = getAssociatedTokenAddressSync(
      state.mintAddress, state.treasury.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Burn from treasury
    const burnIx = await state.stablecoin.burn({
      amount: new BN("5000000000000"),
      fromTokenAccount: treasuryAta,
      burner: sdk.publicKey,
    });
    const sig1 = await sdk.sendInstructions([burnIx]);
    dispatch({ type: "ADD_SIGNATURE", signature: sig1 });

    // Remint to victim
    const victimAta = getAssociatedTokenAddressSync(
      state.mintAddress, state.victim.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const createVictimAta = createAssociatedTokenAccountInstruction(
      sdk.publicKey, victimAta, state.victim.publicKey, state.mintAddress, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const mintIx = await state.stablecoin.mint({
      amount: new BN("5000000000000"),
      recipientTokenAccount: victimAta,
      minter: sdk.publicKey,
    });
    const sig2 = await sdk.sendInstructions([createVictimAta, mintIx]);
    dispatch({ type: "ADD_SIGNATURE", signature: sig2 });

    dispatch({
      type: "SET_STEP_STATUS",
      index: 8,
      status: "success",
      result: `Burned 5M from treasury, reminted 5M to victim`,
      signature: sig1,
    });
  }

  async function executeFinalAudit() {
    if (!state.stablecoin || !state.mintAddress) throw new Error("Initialize first");

    const supply = await state.stablecoin.getSupply();

    // Parse events from all signatures
    const allEvents: SSSEvent[] = [];
    for (const sig of state.signatures) {
      const events = await sdk.parseEvents(sig);
      allEvents.push(...events);
    }

    dispatch({
      type: "SET_STEP_STATUS",
      index: 9,
      status: "success",
      result: `Final supply: ${supply.uiAmount?.toLocaleString()} DUSD | ${allEvents.length} events in audit trail`,
      events: allEvents,
    });
  }

  const advanceStep = useCallback(() => {
    dispatch({ type: "ADVANCE" });
  }, []);

  const reset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  return {
    state,
    executeStep,
    advanceStep,
    reset,
    isComplete: state.currentStepIndex >= state.steps.length,
  };
}
