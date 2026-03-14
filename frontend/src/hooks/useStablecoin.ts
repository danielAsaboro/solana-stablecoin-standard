"use client";

import { useCallback, useEffect, useState } from "react";
import { useSolanaWallet as useWallet, useSolanaConnection as useConnection } from "./usePrivySolana";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  Program,
  AnchorProvider,
  BN,
  EventParser,
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

export interface OperatorActivity {
  id: string;
  timestamp: string | null;
  eventType: string;
  action: string;
  status: string;
  severity: "success" | "warning" | "critical" | "info";
  authority: string | null;
  targetAddress: string | null;
  signature: string;
  source: "rpc" | "backend";
  details: Record<string, unknown>;
}

export interface WebhookDeliverySnapshot {
  id: string;
  webhookId: string | null;
  eventType: string;
  status: string;
  attempts: number;
  retryScheduled: boolean;
  finalized: boolean;
  createdAt: string;
  correlationId: string | null;
  transactionSignature: string | null;
  replayedFrom: string | null;
}

export interface WebhookOverview {
  configured: boolean;
  available: boolean;
  baseUrl: string | null;
  registeredCount: number;
  activeCount: number;
  signingEnabledCount: number;
  failingCount: number;
  signatureHeader: string | null;
  signatureAlgorithm: string | null;
  indexedEvents: number | null;
  lastDeliveryAt: string | null;
  deliveries: Array<WebhookDeliverySnapshot>;
  error: string | null;
}

export type OperatorTimelineSource = "operations" | "indexer" | "compliance" | "webhook";
export type OperatorTimelineSeverity = "info" | "success" | "warning" | "critical";

export interface OperatorTimelineRecord {
  id: string;
  source: OperatorTimelineSource;
  occurredAt: string;
  action: string;
  severity: OperatorTimelineSeverity;
  status: string;
  summary: string;
  eventType: string | null;
  signature: string | null;
  authority: string | null;
  targetAddress: string | null;
  webhookId: string | null;
  replayedFrom: string | null;
  correlationId: string;
  details: Record<string, unknown> | null;
}

export interface OperatorTimelineIncident {
  id: string;
  occurredAt: string;
  action: string;
  severity: OperatorTimelineSeverity;
  status: string;
  summary: string;
  signature: string | null;
  authority: string | null;
  targetAddress: string | null;
  sources: Array<OperatorTimelineSource>;
  relatedCount: number;
  records: Array<OperatorTimelineRecord>;
}

export interface OperatorSnapshotSummary {
  paused: boolean | null;
  liveSupply: number | null;
  roleCount: number | null;
  minterCount: number | null;
  blacklistCount: number | null;
  incidentCount: number;
  activeWebhooks: number;
  failingWebhooks: number;
}

export interface OperatorSnapshotRecord {
  id: string;
  label: string | null;
  createdAt: string;
  summary: OperatorSnapshotSummary;
}

export interface OperatorSnapshotDiff {
  fromSnapshotId: string;
  toSnapshotId: string;
  fromCreatedAt: string;
  toCreatedAt: string;
  changes: Record<string, unknown>;
}

const BACKEND_BASE_URL = process.env.NEXT_PUBLIC_SSS_BACKEND_URL?.replace(/\/+$/, "") ?? null;
const AUDIT_EVENT_NAMES = [
  "StablecoinInitialized",
  "TokensMinted",
  "TokensBurned",
  "AccountFrozen",
  "AccountThawed",
  "StablecoinPaused",
  "StablecoinUnpaused",
  "RoleUpdated",
  "MinterQuotaUpdated",
  "AuthorityTransferred",
  "AddressBlacklisted",
  "AddressUnblacklisted",
  "TokensSeized",
] as const;

function serializeOperatorValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof BN) {
    return value.toString();
  }

  if (value instanceof PublicKey) {
    return value.toBase58();
  }

  if (typeof value === "object" && value !== null && "toBase58" in value) {
    const candidate = value as { toBase58?: () => string };
    if (typeof candidate.toBase58 === "function") {
      return candidate.toBase58();
    }
  }

  if (Array.isArray(value)) {
    return value.map(serializeOperatorValue);
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, innerValue]) => [
        key,
        serializeOperatorValue(innerValue),
      ])
    );
  }

  return value;
}

function asOperatorAddress(value: unknown): string | null {
  const serialized = serializeOperatorValue(value);
  return typeof serialized === "string" ? serialized : null;
}

function activityAction(eventType: string): string {
  switch (eventType) {
    case "StablecoinInitialized":
      return "initialize";
    case "TokensMinted":
      return "mint";
    case "TokensBurned":
      return "burn";
    case "AccountFrozen":
      return "freeze";
    case "AccountThawed":
      return "thaw";
    case "StablecoinPaused":
      return "pause";
    case "StablecoinUnpaused":
      return "unpause";
    case "RoleUpdated":
      return "role.update";
    case "MinterQuotaUpdated":
      return "minter.update";
    case "AuthorityTransferred":
      return "authority.transfer";
    case "AddressBlacklisted":
      return "blacklist.add";
    case "AddressUnblacklisted":
      return "blacklist.remove";
    case "TokensSeized":
      return "seize";
    default:
      return eventType.toLowerCase();
  }
}

function activitySeverity(
  eventType: string,
  details: Record<string, unknown>
): OperatorActivity["severity"] {
  if (eventType === "StablecoinPaused" || eventType === "AccountFrozen") {
    return "warning";
  }

  if (
    eventType === "AddressBlacklisted" ||
    eventType === "AddressUnblacklisted" ||
    eventType === "TokensSeized"
  ) {
    return "critical";
  }

  if (eventType === "RoleUpdated" && details.active === false) {
    return "warning";
  }

  return "success";
}

function activityStatus(
  eventType: string,
  details: Record<string, unknown>
): string {
  if (eventType === "StablecoinPaused") return "paused";
  if (eventType === "StablecoinUnpaused") return "active";
  if (eventType === "AccountFrozen") return "frozen";
  if (eventType === "AccountThawed") return "thawed";
  if (eventType === "AddressBlacklisted") return "restricted";
  if (eventType === "AddressUnblacklisted") return "cleared";
  if (eventType === "RoleUpdated") return details.active === false ? "revoked" : "active";
  return "confirmed";
}

function activityAuthority(
  eventType: string,
  details: Record<string, unknown>
): string | null {
  switch (eventType) {
    case "StablecoinInitialized":
    case "AccountFrozen":
    case "AccountThawed":
    case "StablecoinPaused":
    case "StablecoinUnpaused":
      return asOperatorAddress(details.authority);
    case "TokensMinted":
      return asOperatorAddress(details.minter);
    case "TokensBurned":
      return asOperatorAddress(details.burner);
    case "RoleUpdated":
    case "MinterQuotaUpdated":
      return asOperatorAddress(details.updatedBy);
    case "AddressBlacklisted":
      return asOperatorAddress(details.blacklistedBy);
    case "AddressUnblacklisted":
      return asOperatorAddress(details.removedBy);
    case "TokensSeized":
      return asOperatorAddress(details.seizedBy);
    default:
      return null;
  }
}

function activityTarget(
  eventType: string,
  details: Record<string, unknown>
): string | null {
  switch (eventType) {
    case "TokensMinted":
      return asOperatorAddress(details.recipient);
    case "TokensBurned":
    case "TokensSeized":
      return asOperatorAddress(details.from);
    case "AccountFrozen":
    case "AccountThawed":
      return asOperatorAddress(details.account);
    case "RoleUpdated":
      return asOperatorAddress(details.user);
    case "MinterQuotaUpdated":
      return asOperatorAddress(details.minter);
    case "AuthorityTransferred":
      return asOperatorAddress(details.newAuthority);
    case "AddressBlacklisted":
    case "AddressUnblacklisted":
      return asOperatorAddress(details.address);
    default:
      return null;
  }
}

function normalizeOperatorActivity(
  eventType: string,
  signature: string,
  timestamp: number | string | null,
  data: Record<string, unknown>,
  source: OperatorActivity["source"]
): OperatorActivity {
  const details = serializeOperatorValue(data) as Record<string, unknown>;
  const normalizedTimestamp =
    typeof timestamp === "number"
      ? new Date(timestamp * 1000).toISOString()
      : typeof timestamp === "string"
        ? timestamp
        : null;

  return {
    id: `${source}:${signature}:${eventType}`,
    timestamp: normalizedTimestamp,
    eventType,
    action: activityAction(eventType),
    status: activityStatus(eventType, details),
    severity: activitySeverity(eventType, details),
    authority: activityAuthority(eventType, details),
    targetAddress: activityTarget(eventType, details),
    signature,
    source,
    details,
  };
}

function timelineIncidentFromActivity(activity: OperatorActivity): OperatorTimelineIncident {
  return {
    id: activity.id,
    occurredAt: activity.timestamp ?? new Date().toISOString(),
    action: activity.action,
    severity: activity.severity,
    status: activity.status,
    summary: `${activity.eventType} via ${activity.source === "backend" ? "backend indexer" : "direct RPC"}`,
    signature: activity.signature,
    authority: activity.authority,
    targetAddress: activity.targetAddress,
    sources: [activity.source === "backend" ? "indexer" : "indexer"],
    relatedCount: 1,
    records: [
      {
        id: activity.id,
        source: "indexer",
        occurredAt: activity.timestamp ?? new Date().toISOString(),
        action: activity.action,
        severity: activity.severity,
        status: activity.status,
        summary: activity.eventType,
        eventType: activity.eventType,
        signature: activity.signature,
        authority: activity.authority,
        targetAddress: activity.targetAddress,
        webhookId: null,
        replayedFrom: null,
        correlationId: activity.id,
        details: activity.details,
      },
    ],
  };
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
  seizeTokens: (fromOwner: string, toOwner: string, amount: string) => Promise<string>;

  // Read
  fetchRoles: () => Promise<RoleAccountData[]>;
  fetchMinterQuotas: () => Promise<MinterQuotaData[]>;
  fetchBlacklist: () => Promise<BlacklistEntryData[]>;
  fetchSupply: () => Promise<string>;
  fetchRecentActivity: (limit?: number) => Promise<Array<OperatorActivity>>;
  fetchWebhookOverview: (limit?: number) => Promise<WebhookOverview | null>;
  fetchOperatorTimeline: (
    limit?: number,
    filters?: {
      source?: OperatorTimelineSource;
      severity?: OperatorTimelineSeverity;
      action?: string;
      status?: string;
      address?: string;
      authority?: string;
      signature?: string;
      dateFrom?: string;
      dateTo?: string;
    }
  ) => Promise<Array<OperatorTimelineIncident>>;
  fetchOperatorEvidence: () => Promise<Record<string, unknown> | null>;
  createOperatorSnapshot: (label?: string) => Promise<OperatorSnapshotRecord | null>;
  listOperatorSnapshots: (limit?: number) => Promise<Array<OperatorSnapshotRecord>>;
  diffOperatorSnapshots: (
    fromSnapshotId: string,
    toSnapshotId: string
  ) => Promise<OperatorSnapshotDiff | null>;
  redeliverIncident: (
    incidentId: string,
    webhookId?: string
  ) => Promise<Array<WebhookDeliverySnapshot>>;
  redeliverDelivery: (deliveryId: string) => Promise<WebhookDeliverySnapshot | null>;
  backendBaseUrl: string | null;
  rpcEndpoint: string;
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

  // Seize tokens via permanent delegate (SSS-2 only)
  const seizeTokens = useCallback(
    async (fromOwner: string, toOwner: string, amount: string): Promise<string> => {
      if (!program || !configAddress || !mintAddress || !wallet.publicKey)
        throw new Error("Not ready");

      const fromPubkey = new PublicKey(fromOwner);
      const toPubkey = new PublicKey(toOwner);
      const [roleAccount] = getRoleAddress(
        configAddress,
        ROLE_TYPES.Seizer,
        wallet.publicKey
      );
      const fromTokenAccount = getAssociatedTokenAddressSync(mintAddress, fromPubkey, false, TOKEN_2022_PROGRAM_ID);
      const toTokenAccount = getAssociatedTokenAddressSync(mintAddress, toPubkey, false, TOKEN_2022_PROGRAM_ID);

      const ix = await program.methods
        .seize(new BN(amount))
        .accountsStrict({
          authority: wallet.publicKey,
          config: configAddress,
          roleAccount,
          mint: mintAddress,
          fromTokenAccount,
          toTokenAccount,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .instruction();

      const tx = new Transaction().add(ix);
      return sendTx(tx);
    },
    [program, configAddress, mintAddress, wallet.publicKey, sendTx]
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

  const fetchRecentActivity = useCallback(
    async (limit = 8): Promise<Array<OperatorActivity>> => {
      if (!configAddress) {
        return [];
      }

      if (BACKEND_BASE_URL) {
        try {
          const response = await fetch(
            `${BACKEND_BASE_URL}/api/v1/events?limit=${Math.max(limit, 1)}`,
            { cache: "no-store" }
          );
          if (response.ok) {
            const events = (await response.json()) as Array<{
              event_type: string;
              signature: string;
              timestamp?: number | null;
              data?: Record<string, unknown>;
            }>;
            return events.map((event) =>
              normalizeOperatorActivity(
                event.event_type,
                event.signature,
                event.timestamp ?? null,
                event.data ?? {},
                "backend"
              )
            );
          }
        } catch {
          // Fall back to direct RPC parsing below.
        }
      }

      if (!program) {
        return [];
      }

      const eventParser = new EventParser(program.programId, program.coder);
      const signatureInfos = await connection.getSignaturesForAddress(configAddress, {
        limit: Math.min(limit * 3, 24),
      });
      const activities: Array<OperatorActivity> = [];

      for (const signatureInfo of signatureInfos) {
        if (activities.length >= limit || signatureInfo.err) {
          continue;
        }

        const transaction = await connection.getTransaction(signatureInfo.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });

        const logMessages = transaction?.meta?.logMessages;
        if (!logMessages) {
          continue;
        }

        try {
          const parsedEvents = eventParser.parseLogs(logMessages);
          let nextEvent = parsedEvents.next();
          while (!nextEvent.done) {
            const parsedEvent = nextEvent.value;
            const eventType = parsedEvent.name;
            if (!AUDIT_EVENT_NAMES.includes(eventType as (typeof AUDIT_EVENT_NAMES)[number])) {
              nextEvent = parsedEvents.next();
              continue;
            }

            activities.push(
              normalizeOperatorActivity(
                eventType,
                signatureInfo.signature,
                transaction?.blockTime ?? null,
                parsedEvent.data as Record<string, unknown>,
                "rpc"
              )
            );

            if (activities.length >= limit) {
              break;
            }

            nextEvent = parsedEvents.next();
          }
        } catch {
          continue;
        }
      }

      return activities;
    },
    [configAddress, connection, program]
  );

  const fetchWebhookOverview = useCallback(
    async (limit = 8): Promise<WebhookOverview | null> => {
      if (!BACKEND_BASE_URL) {
        return null;
      }

      try {
        const [webhooksResponse, deliveriesResponse, statusResponse] = await Promise.all([
          fetch(`${BACKEND_BASE_URL}/api/v1/webhooks`, { cache: "no-store" }),
          fetch(`${BACKEND_BASE_URL}/api/v1/webhooks/deliveries?limit=${Math.max(limit, 1)}`, {
            cache: "no-store",
          }),
          fetch(`${BACKEND_BASE_URL}/api/v1/events/status`, { cache: "no-store" }),
        ]);

        const webhooks = webhooksResponse.ok
          ? ((await webhooksResponse.json()) as Array<{
              active: boolean;
              signing_enabled?: boolean;
              signature_header?: string | null;
              signature_algorithm?: string | null;
              last_delivery_at?: string | null;
              failure_count?: number;
            }>)
          : [];
        const deliveries = deliveriesResponse.ok
          ? ((await deliveriesResponse.json()) as Array<{
              id: string;
              webhook_id?: string | null;
              event_type: string;
              status: string;
              attempts: number;
              retry_scheduled?: boolean;
              finalized?: boolean;
              created_at: string;
              correlation_id?: string | null;
              transaction_signature?: string | null;
              replayed_from?: string | null;
            }>)
          : [];
        const eventsStatus = statusResponse.ok
          ? ((await statusResponse.json()) as { total_events?: number })
          : {};

        return {
          configured: true,
          available: webhooksResponse.ok && deliveriesResponse.ok,
          baseUrl: BACKEND_BASE_URL,
          registeredCount: webhooks.length,
          activeCount: webhooks.filter((webhook) => webhook.active).length,
          signingEnabledCount: webhooks.filter((webhook) => webhook.signing_enabled).length,
          failingCount: webhooks.filter((webhook) => (webhook.failure_count ?? 0) > 0).length,
          signatureHeader:
            webhooks.find((webhook) => webhook.signature_header)?.signature_header ?? null,
          signatureAlgorithm:
            webhooks.find((webhook) => webhook.signature_algorithm)?.signature_algorithm ?? null,
          indexedEvents: eventsStatus.total_events ?? null,
          lastDeliveryAt:
            webhooks
              .map((webhook) => webhook.last_delivery_at ?? null)
              .filter((value): value is string => value !== null)
              .sort()
              .at(-1) ?? null,
          deliveries: deliveries.map((delivery) => ({
              id: delivery.id,
              webhookId: delivery.webhook_id ?? null,
              eventType: delivery.event_type,
              status: delivery.status,
              attempts: delivery.attempts,
              retryScheduled: delivery.retry_scheduled ?? false,
              finalized: delivery.finalized ?? delivery.status !== "pending",
              createdAt: delivery.created_at,
              correlationId: delivery.correlation_id ?? null,
              transactionSignature: delivery.transaction_signature ?? null,
              replayedFrom: delivery.replayed_from ?? null,
            })),
          error:
            webhooksResponse.ok && deliveriesResponse.ok
              ? null
              : "Backend operator telemetry is configured but currently unavailable.",
        };
      } catch (error: unknown) {
        return {
          configured: true,
          available: false,
          baseUrl: BACKEND_BASE_URL,
          registeredCount: 0,
          activeCount: 0,
          signingEnabledCount: 0,
          failingCount: 0,
          signatureHeader: null,
          signatureAlgorithm: null,
          indexedEvents: null,
          lastDeliveryAt: null,
          deliveries: [],
          error: error instanceof Error ? error.message : "Failed to load backend telemetry",
        };
      }
    },
    []
  );

  const fetchOperatorTimeline = useCallback(
    async (
      limit = 12,
        filters?: {
          source?: OperatorTimelineSource;
          severity?: OperatorTimelineSeverity;
          action?: string;
          status?: string;
          address?: string;
          authority?: string;
          signature?: string;
          dateFrom?: string;
          dateTo?: string;
        }
    ): Promise<Array<OperatorTimelineIncident>> => {
      if (!BACKEND_BASE_URL) {
        const activities = await fetchRecentActivity(limit);
        return activities.map(timelineIncidentFromActivity);
      }

      const params = new URLSearchParams({
        limit: String(Math.max(limit, 1)),
      });
      if (filters?.source) {
        params.set("source", filters.source);
      }
      if (filters?.severity) {
        params.set("severity", filters.severity);
      }
      if (filters?.action) {
        params.set("action", filters.action);
      }
      if (filters?.status) {
        params.set("status", filters.status);
      }
      if (filters?.address) {
        params.set("address", filters.address);
      }
      if (filters?.authority) {
        params.set("authority", filters.authority);
      }
      if (filters?.signature) {
        params.set("signature", filters.signature);
      }
      if (filters?.dateFrom) {
        params.set("date_from", filters.dateFrom);
      }
      if (filters?.dateTo) {
        params.set("date_to", filters.dateTo);
      }

      try {
        const response = await fetch(
          `${BACKEND_BASE_URL}/api/v1/operator-timeline?${params.toString()}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          throw new Error(`Timeline request failed with status ${response.status}`);
        }

        const incidents = (await response.json()) as Array<{
          id: string;
          occurred_at: string;
          action: string;
          severity: OperatorTimelineSeverity;
          status: string;
          summary: string;
          signature?: string | null;
          authority?: string | null;
          target_address?: string | null;
          sources: Array<OperatorTimelineSource>;
          related_count: number;
          records: Array<{
            id: string;
            source: OperatorTimelineSource;
            occurred_at: string;
            action: string;
            severity: OperatorTimelineSeverity;
            status: string;
            summary: string;
            event_type?: string | null;
            signature?: string | null;
            authority?: string | null;
            target_address?: string | null;
            webhook_id?: string | null;
            replayed_from?: string | null;
            correlation_id: string;
            details?: Record<string, unknown> | null;
          }>;
        }>;

        return incidents.map((incident) => ({
          id: incident.id,
          occurredAt: incident.occurred_at,
          action: incident.action,
          severity: incident.severity,
          status: incident.status,
          summary: incident.summary,
          signature: incident.signature ?? null,
          authority: incident.authority ?? null,
          targetAddress: incident.target_address ?? null,
          sources: incident.sources,
          relatedCount: incident.related_count,
          records: incident.records.map((record) => ({
            id: record.id,
            source: record.source,
            occurredAt: record.occurred_at,
            action: record.action,
            severity: record.severity,
            status: record.status,
            summary: record.summary,
            eventType: record.event_type ?? null,
            signature: record.signature ?? null,
            authority: record.authority ?? null,
            targetAddress: record.target_address ?? null,
            webhookId: record.webhook_id ?? null,
            replayedFrom: record.replayed_from ?? null,
            correlationId: record.correlation_id,
            details: record.details ?? null,
          })),
        }));
      } catch {
        const activities = await fetchRecentActivity(limit);
        return activities.map(timelineIncidentFromActivity);
      }
    },
    [fetchRecentActivity]
  );

  const fetchOperatorEvidence = useCallback(async (): Promise<Record<string, unknown> | null> => {
    if (!BACKEND_BASE_URL) {
      return null;
    }

    const response = await fetch(`${BACKEND_BASE_URL}/api/v1/operator-evidence`, {
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Evidence request failed with status ${response.status}`);
    }

    return (await response.json()) as Record<string, unknown>;
  }, []);

  const createOperatorSnapshot = useCallback(
    async (label?: string): Promise<OperatorSnapshotRecord | null> => {
      if (!BACKEND_BASE_URL) {
        return null;
      }

      const response = await fetch(`${BACKEND_BASE_URL}/api/v1/operator-snapshots`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ label: label ?? null }),
      });

      if (!response.ok) {
        throw new Error(`Snapshot request failed with status ${response.status}`);
      }

      const snapshot = (await response.json()) as {
        id: string;
        label?: string | null;
        created_at: string;
        summary: {
          paused?: boolean | null;
          live_supply?: number | null;
          role_count?: number | null;
          minter_count?: number | null;
          blacklist_count?: number | null;
          incident_count: number;
          active_webhooks: number;
          failing_webhooks: number;
        };
      };

      return {
        id: snapshot.id,
        label: snapshot.label ?? null,
        createdAt: snapshot.created_at,
        summary: {
          paused: snapshot.summary.paused ?? null,
          liveSupply: snapshot.summary.live_supply ?? null,
          roleCount: snapshot.summary.role_count ?? null,
          minterCount: snapshot.summary.minter_count ?? null,
          blacklistCount: snapshot.summary.blacklist_count ?? null,
          incidentCount: snapshot.summary.incident_count,
          activeWebhooks: snapshot.summary.active_webhooks,
          failingWebhooks: snapshot.summary.failing_webhooks,
        },
      };
    },
    []
  );

  const listOperatorSnapshots = useCallback(
    async (limit = 8): Promise<Array<OperatorSnapshotRecord>> => {
      if (!BACKEND_BASE_URL) {
        return [];
      }

      const response = await fetch(
        `${BACKEND_BASE_URL}/api/v1/operator-snapshots?limit=${Math.max(limit, 1)}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(`Snapshot list request failed with status ${response.status}`);
      }

      const snapshots = (await response.json()) as Array<{
        id: string;
        label?: string | null;
        created_at: string;
        summary: {
          paused?: boolean | null;
          live_supply?: number | null;
          role_count?: number | null;
          minter_count?: number | null;
          blacklist_count?: number | null;
          incident_count: number;
          active_webhooks: number;
          failing_webhooks: number;
        };
      }>;

      return snapshots.map((snapshot) => ({
        id: snapshot.id,
        label: snapshot.label ?? null,
        createdAt: snapshot.created_at,
        summary: {
          paused: snapshot.summary.paused ?? null,
          liveSupply: snapshot.summary.live_supply ?? null,
          roleCount: snapshot.summary.role_count ?? null,
          minterCount: snapshot.summary.minter_count ?? null,
          blacklistCount: snapshot.summary.blacklist_count ?? null,
          incidentCount: snapshot.summary.incident_count,
          activeWebhooks: snapshot.summary.active_webhooks,
          failingWebhooks: snapshot.summary.failing_webhooks,
        },
      }));
    },
    []
  );

  const diffOperatorSnapshots = useCallback(
    async (
      fromSnapshotId: string,
      toSnapshotId: string
    ): Promise<OperatorSnapshotDiff | null> => {
      if (!BACKEND_BASE_URL) {
        return null;
      }

      const params = new URLSearchParams({
        from: fromSnapshotId,
        to: toSnapshotId,
      });
      const response = await fetch(
        `${BACKEND_BASE_URL}/api/v1/operator-snapshots/diff?${params.toString()}`,
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(`Snapshot diff request failed with status ${response.status}`);
      }

      const diff = (await response.json()) as {
        from_snapshot_id: string;
        to_snapshot_id: string;
        from_created_at: string;
        to_created_at: string;
        changes: Record<string, unknown>;
      };

      return {
        fromSnapshotId: diff.from_snapshot_id,
        toSnapshotId: diff.to_snapshot_id,
        fromCreatedAt: diff.from_created_at,
        toCreatedAt: diff.to_created_at,
        changes: diff.changes,
      };
    },
    []
  );

  const redeliverIncident = useCallback(
    async (incidentId: string, webhookId?: string): Promise<Array<WebhookDeliverySnapshot>> => {
      if (!BACKEND_BASE_URL) {
        return [];
      }

      const params = new URLSearchParams();
      if (webhookId) {
        params.set("webhook_id", webhookId);
      }

      const response = await fetch(
        `${BACKEND_BASE_URL}/api/v1/operator-timeline/${incidentId}/redeliver${
          params.toString() ? `?${params.toString()}` : ""
        }`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(`Incident replay failed with status ${response.status}`);
      }

      const deliveries = (await response.json()) as Array<{
        id: string;
        webhook_id?: string | null;
        event_type: string;
        status: string;
        attempts: number;
        retry_scheduled?: boolean;
        finalized?: boolean;
        created_at: string;
        correlation_id?: string | null;
        transaction_signature?: string | null;
        replayed_from?: string | null;
      }>;

      return deliveries.map((delivery) => ({
        id: delivery.id,
        webhookId: delivery.webhook_id ?? null,
        eventType: delivery.event_type,
        status: delivery.status,
        attempts: delivery.attempts,
        retryScheduled: delivery.retry_scheduled ?? false,
        finalized: delivery.finalized ?? delivery.status !== "pending",
        createdAt: delivery.created_at,
        correlationId: delivery.correlation_id ?? null,
        transactionSignature: delivery.transaction_signature ?? null,
        replayedFrom: delivery.replayed_from ?? null,
      }));
    },
    []
  );

  const redeliverDelivery = useCallback(
    async (deliveryId: string): Promise<WebhookDeliverySnapshot | null> => {
      if (!BACKEND_BASE_URL) {
        return null;
      }

      const response = await fetch(
        `${BACKEND_BASE_URL}/api/v1/webhooks/deliveries/${deliveryId}/redeliver`,
        { method: "POST" }
      );
      if (!response.ok) {
        throw new Error(`Delivery replay failed with status ${response.status}`);
      }

      const delivery = (await response.json()) as {
        id: string;
        webhook_id?: string | null;
        event_type: string;
        status: string;
        attempts: number;
        retry_scheduled?: boolean;
        finalized?: boolean;
        created_at: string;
        correlation_id?: string | null;
        transaction_signature?: string | null;
        replayed_from?: string | null;
      };

      return {
        id: delivery.id,
        webhookId: delivery.webhook_id ?? null,
        eventType: delivery.event_type,
        status: delivery.status,
        attempts: delivery.attempts,
        retryScheduled: delivery.retry_scheduled ?? false,
        finalized: delivery.finalized ?? delivery.status !== "pending",
        createdAt: delivery.created_at,
        correlationId: delivery.correlation_id ?? null,
        transactionSignature: delivery.transaction_signature ?? null,
        replayedFrom: delivery.replayed_from ?? null,
      };
    },
    []
  );

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
    seizeTokens,
    fetchRoles,
    fetchMinterQuotas,
    fetchBlacklist,
    fetchSupply,
    fetchRecentActivity,
    fetchWebhookOverview,
    fetchOperatorTimeline,
    fetchOperatorEvidence,
    createOperatorSnapshot,
    listOperatorSnapshots,
    diffOperatorSnapshots,
    redeliverIncident,
    redeliverDelivery,
    backendBaseUrl: BACKEND_BASE_URL,
    rpcEndpoint: connection.rpcEndpoint,
  };
}
