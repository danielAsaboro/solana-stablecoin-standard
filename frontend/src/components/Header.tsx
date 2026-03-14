"use client";

import { FC, useState } from "react";
import { usePrivyLogin, useSolanaWallet } from "@/hooks/usePrivySolana";
import { truncateAddress } from "@/lib/constants";
import { type WebhookOverview } from "@/hooks/useStablecoin";

interface HeaderProps {
  mintInput: string;
  onMintInputChange: (value: string) => void;
  onLoad: () => void;
  onRefresh: () => void;
  loading: boolean;
  ready: boolean;
  loadError: string | null;
  statsError: string | null;
  config: {
    symbol: string;
    paused: boolean;
    enablePermanentDelegate: boolean;
    enableTransferHook: boolean;
  } | null;
  rpcEndpoint: string;
  backendBaseUrl: string | null;
  webhookOverview: WebhookOverview | null;
  telemetryLabel: string;
  lastRefreshedAt: string | null;
  lastOperatorAction: { action: string; signature: string; occurredAt: string } | null;
  walletConnected: boolean;
  onToggleMobileMenu: () => void;
}

const Header: FC<HeaderProps> = ({
  mintInput,
  onMintInputChange,
  onLoad,
  onRefresh,
  loading,
  ready,
  loadError,
  statsError,
  config,
  rpcEndpoint,
  backendBaseUrl,
  webhookOverview,
  telemetryLabel,
  lastRefreshedAt,
  lastOperatorAction,
  walletConnected,
  onToggleMobileMenu,
}) => {
  const { login, logout, authenticated } = usePrivyLogin();
  const { publicKey } = useSolanaWallet();
  const [showDisconnect, setShowDisconnect] = useState(false);

  return (
    <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 px-4 py-4 backdrop-blur-md md:px-8 md:py-5">
      <div className="flex flex-col gap-4">
        {/* Row 1: Hamburger + Logo + Wallet */}
        <div className="flex items-center gap-3">
          <button
            onClick={onToggleMobileMenu}
            className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white lg:hidden"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
            </svg>
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-xs font-semibold text-white">
              SSS
            </div>
            <span className="text-sm font-semibold text-white">Stablecoin Console</span>
          </div>

          <div className="flex-1" />

          {/* Wallet controls */}
          {authenticated && publicKey ? (
            <div className="relative">
              <button
                onClick={() => setShowDisconnect((prev) => !prev)}
                className="wallet-pill"
              >
                <span className="connected-dot" />
                <span className="font-mono text-xs text-slate-200">
                  {truncateAddress(publicKey.toBase58())}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void navigator.clipboard.writeText(publicKey.toBase58());
                  }}
                  className="text-slate-500 transition-colors hover:text-slate-200"
                  title="Copy address"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </button>
              </button>
              {showDisconnect && (
                <div className="absolute right-0 top-full mt-2 rounded-xl border border-slate-700 bg-slate-900 p-1 shadow-xl">
                  <button
                    onClick={() => { logout(); setShowDisconnect(false); }}
                    className="w-full rounded-lg px-4 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-white"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={login} className="btn-primary px-4 py-2 text-sm">
              Sign In
            </button>
          )}
        </div>

        {/* Row 2: Mint input + Status badges */}
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="flex-1">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <input
                type="text"
                value={mintInput}
                onChange={(e) => onMintInputChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onLoad()}
                placeholder="Load a stablecoin by mint address"
                className="input-field max-w-2xl"
                disabled={!ready}
              />
              <div className="flex gap-3">
                <button
                  onClick={onLoad}
                  disabled={!ready || !mintInput.trim() || loading}
                  className="btn-primary"
                >
                  {loading ? "Loading..." : "Load"}
                </button>
                {config && (
                  <button onClick={onRefresh} className="btn-secondary">
                    Refresh
                  </button>
                )}
              </div>
            </div>
            {loadError && <p className="mt-2 text-sm text-red-300">{loadError}</p>}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="status-tile">
              <span className="status-tile-label">Preset</span>
              <span
                className={
                  config?.enablePermanentDelegate && config?.enableTransferHook
                    ? "badge-green"
                    : config
                      ? "badge-blue"
                      : "badge-muted"
                }
              >
                {config
                  ? config.enablePermanentDelegate && config.enableTransferHook
                    ? "SSS-2"
                    : config.enablePermanentDelegate || config.enableTransferHook
                      ? "Custom"
                      : "SSS-1"
                  : "Unloaded"}
              </span>
            </div>
            <div className="status-tile">
              <span className="status-tile-label">Runtime</span>
              <span className={config?.paused ? "badge-red" : "badge-green"}>
                {config?.paused ? "Paused" : "Active"}
              </span>
            </div>
            <div className="status-tile">
              <span className="status-tile-label">Telemetry</span>
              <span
                className={
                  backendBaseUrl
                    ? webhookOverview?.available
                      ? "badge-blue"
                      : "badge-yellow"
                    : "badge-muted"
                }
              >
                {telemetryLabel}
              </span>
            </div>
          </div>
        </div>

        {/* Config badges + last refresh */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {config && (
              <>
                <span className="badge-muted">{config.symbol} operator surface</span>
                <span className="badge-muted">
                  RPC: {rpcEndpoint.replace(/^https?:\/\//, "")}
                </span>
                {backendBaseUrl && (
                  <span className="badge-muted">
                    Backend: {backendBaseUrl.replace(/^https?:\/\//, "")}
                  </span>
                )}
              </>
            )}
          </div>
          <p className="text-sm text-slate-400">
            {lastRefreshedAt
              ? `Last console refresh ${new Date(lastRefreshedAt).toLocaleTimeString()}`
              : "Load a mint to start the operator console"}
          </p>
        </div>

        {statsError && <p className="text-sm text-amber-300">{statsError}</p>}
        {lastOperatorAction && (
          <p className="text-sm text-emerald-300">
            Last operator action: {lastOperatorAction.action}{" "}
            <span className="font-mono text-emerald-200">{lastOperatorAction.signature}</span>
          </p>
        )}
        {!walletConnected && (
          <p className="text-sm text-amber-200">
            Connect a wallet to execute admin instructions. Overview and audit panels stay
            available without a signer.
          </p>
        )}
      </div>
    </header>
  );
};

export default Header;
