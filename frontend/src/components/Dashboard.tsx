"use client";

import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { truncateAddress, formatTokenAmount } from "@/lib/constants";

interface DashboardProps {
  config: {
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
  } | null;
  configAddress: PublicKey | null;
  mintAddress: PublicKey | null;
  supply: string;
  roleCount: number;
  blacklistCount: number;
}

function CheckIcon() {
  return (
    <svg
      className="h-5 w-5 text-green-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-5 w-5 text-red-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-2 text-gray-500 transition-colors hover:text-gray-300"
      title="Copy to clipboard"
    >
      <svg
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
    </button>
  );
}

function AddressRow({ label, address }: { label: string; address: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="stat-label">{label}</span>
      <span className="flex items-center font-mono text-sm text-gray-300">
        {truncateAddress(address)}
        <CopyButton text={address} />
      </span>
    </div>
  );
}

function FeatureRow({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-gray-300">{label}</span>
      {enabled ? <CheckIcon /> : <XIcon />}
    </div>
  );
}

function getPresetBadge(
  enablePermanentDelegate: boolean,
  enableTransferHook: boolean
): { label: string; className: string } {
  if (!enablePermanentDelegate && !enableTransferHook) {
    return { label: "SSS-1", className: "badge-blue" };
  }
  if (enablePermanentDelegate && enableTransferHook) {
    return { label: "SSS-2", className: "badge-green" };
  }
  return { label: "Custom", className: "badge-yellow" };
}

export default function Dashboard({
  config,
  configAddress,
  mintAddress,
  supply,
  roleCount,
  blacklistCount,
}: DashboardProps) {
  if (!config) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <p className="text-lg text-gray-400">
            No stablecoin loaded. Enter a mint address above.
          </p>
        </div>
      </div>
    );
  }

  const netSupply = config.totalMinted.sub(config.totalBurned);
  const preset = getPresetBadge(
    config.enablePermanentDelegate,
    config.enableTransferHook
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {/* Supply Overview — spans 2 columns */}
      <div className="card md:col-span-2">
        <h3 className="card-header">Supply Overview</h3>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <div>
            <p className="stat-value">
              {formatTokenAmount(supply, config.decimals)}
            </p>
            <p className="stat-label">Live Supply</p>
          </div>
          <div>
            <p className="stat-value">
              {formatTokenAmount(config.totalMinted.toString(), config.decimals)}
            </p>
            <p className="stat-label">Total Minted</p>
          </div>
          <div>
            <p className="stat-value">
              {formatTokenAmount(config.totalBurned.toString(), config.decimals)}
            </p>
            <p className="stat-label">Total Burned</p>
          </div>
          <div>
            <p className="stat-value">
              {formatTokenAmount(netSupply.toString(), config.decimals)}
            </p>
            <p className="stat-label">Net Supply</p>
          </div>
        </div>
      </div>

      {/* Token Identity */}
      <div className="card">
        <h3 className="card-header">Token Identity</h3>
        <div className="space-y-3">
          <div>
            <p className="stat-label">Name</p>
            <p className="text-lg font-semibold text-white">{config.name}</p>
          </div>
          <div>
            <p className="stat-label">Symbol</p>
            <p className="text-lg font-semibold text-white">{config.symbol}</p>
          </div>
          <div>
            <p className="stat-label">Decimals</p>
            <p className="text-lg font-semibold text-white">
              {config.decimals}
            </p>
          </div>
          <div>
            <p className="stat-label">URI</p>
            <p className="truncate text-sm text-gray-300" title={config.uri}>
              {config.uri || "None"}
            </p>
          </div>
        </div>
      </div>

      {/* Addresses */}
      <div className="card">
        <h3 className="card-header">Addresses</h3>
        <div className="divide-y divide-gray-800">
          {mintAddress && (
            <AddressRow
              label="Mint"
              address={mintAddress.toBase58()}
            />
          )}
          {configAddress && (
            <AddressRow
              label="Config PDA"
              address={configAddress.toBase58()}
            />
          )}
          <AddressRow
            label="Master Authority"
            address={config.masterAuthority.toBase58()}
          />
        </div>
      </div>

      {/* Feature Flags */}
      <div className="card">
        <h3 className="card-header">Feature Flags</h3>
        <div className="space-y-1">
          <FeatureRow
            label="Permanent Delegate"
            enabled={config.enablePermanentDelegate}
          />
          <FeatureRow
            label="Transfer Hook"
            enabled={config.enableTransferHook}
          />
          <FeatureRow
            label="Default Frozen"
            enabled={config.defaultAccountFrozen}
          />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="stat-label">Preset</span>
          <span className={preset.className}>{preset.label}</span>
        </div>
      </div>

      {/* Runtime State */}
      <div className="card">
        <h3 className="card-header">Runtime State</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Status</span>
            {config.paused ? (
              <span className="badge-red">PAUSED</span>
            ) : (
              <span className="badge-green">Active</span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Active Roles</span>
            <span className="stat-value text-lg">{roleCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">Blacklist Entries</span>
            <span className="stat-value text-lg">{blacklistCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
