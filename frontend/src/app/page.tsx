"use client";

import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import Sidebar from "@/components/Sidebar";
import Dashboard from "@/components/Dashboard";
import MintBurn from "@/components/MintBurn";
import Roles from "@/components/Roles";
import FreezeThaw from "@/components/FreezeThaw";
import Blacklist from "@/components/Blacklist";
import PauseControl from "@/components/PauseControl";
import Seize from "@/components/Seize";
import {
  useStablecoin,
  type OperatorTimelineIncident,
  type OperatorSnapshotDiff,
  type OperatorSnapshotRecord,
  type WebhookOverview,
} from "@/hooks/useStablecoin";

type ViewType =
  | "dashboard"
  | "mint-burn"
  | "roles"
  | "freeze-thaw"
  | "blacklist"
  | "pause"
  | "seize";

export default function Home() {
  const wallet = useWallet();
  const stablecoin = useStablecoin();
  const [activeView, setActiveView] = useState<ViewType>("dashboard");
  const [mintInput, setMintInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [supply, setSupply] = useState("0");
  const [roleCount, setRoleCount] = useState(0);
  const [minterCount, setMinterCount] = useState(0);
  const [blacklistCount, setBlacklistCount] = useState(0);
  const [timelineIncidents, setTimelineIncidents] = useState<Array<OperatorTimelineIncident>>([]);
  const [webhookOverview, setWebhookOverview] = useState<WebhookOverview | null>(null);
  const [snapshots, setSnapshots] = useState<Array<OperatorSnapshotRecord>>([]);
  const [snapshotDiff, setSnapshotDiff] = useState<OperatorSnapshotDiff | null>(null);
  const [lastOperatorAction, setLastOperatorAction] = useState<{
    action: string;
    signature: string;
    occurredAt: string;
  } | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    if (!stablecoin.config) {
      return;
    }

    setStatsError(null);

    try {
      const [currentSupply, roles, blacklist, minters, timeline, webhookStatus, latestSnapshots] =
        await Promise.all([
          stablecoin.fetchSupply(),
          stablecoin.fetchRoles(),
          stablecoin.fetchBlacklist(),
          stablecoin.fetchMinterQuotas(),
          stablecoin.fetchOperatorTimeline(12),
          stablecoin.fetchWebhookOverview(6),
          stablecoin.listOperatorSnapshots(6),
        ]);

      setSupply(currentSupply);
      setRoleCount(roles.filter((role) => role.active).length);
      setMinterCount(minters.length);
      setBlacklistCount(blacklist.length);
      setTimelineIncidents(timeline);
      setWebhookOverview(webhookStatus);
      setSnapshots(latestSnapshots);
      if (latestSnapshots.length >= 2) {
        const diff = await stablecoin.diffOperatorSnapshots(
          latestSnapshots[1].id,
          latestSnapshots[0].id
        );
        setSnapshotDiff(diff);
      } else {
        setSnapshotDiff(null);
      }
      setLastRefreshedAt(new Date().toISOString());
    } catch (error: unknown) {
      setStatsError(
        error instanceof Error
          ? error.message
          : "Operator overview could not be refreshed. Existing data may be stale."
      );
    }
  }, [stablecoin]);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const handleLoad = async () => {
    if (!mintInput.trim()) {
      return;
    }

    setLoadError(null);
    try {
      await stablecoin.loadStablecoin(mintInput.trim());
      await refreshStats();
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : String(error));
    }
  };

  const telemetryLabel = stablecoin.backendBaseUrl
    ? webhookOverview?.available
      ? "Backend-aware"
      : "Backend configured"
    : "RPC only";

  const runTrackedAction = useCallback(
    async <Args extends Array<string | number | boolean>>(
      action: string,
      handler: (...args: Args) => Promise<string>,
      ...args: Args
    ): Promise<string> => {
      const signature = await handler(...args);
      setLastOperatorAction({
        action,
        signature,
        occurredAt: new Date().toISOString(),
      });
      await refreshStats();
      return signature;
    },
    [refreshStats]
  );

  const handleCreateSnapshot = useCallback(async () => {
    const snapshot = await stablecoin.createOperatorSnapshot(
      stablecoin.config?.symbol ? `${stablecoin.config.symbol} operator snapshot` : undefined
    );
    if (snapshot) {
      await refreshStats();
    }
    return snapshot;
  }, [refreshStats, stablecoin]);

  return (
    <div className="flex min-h-screen overflow-hidden bg-shell">
      <Sidebar
        activeView={activeView}
        onViewChange={(view) => setActiveView(view as ViewType)}
        statusLabel={telemetryLabel}
        symbol={stablecoin.config?.symbol ?? null}
        paused={stablecoin.config?.paused ?? false}
      />

      <main className="flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-slate-800 bg-slate-950/90 px-6 py-5 backdrop-blur-md md:px-8">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
              <div className="flex-1">
                <p className="eyebrow">Stablecoin Operations Console</p>
                <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center">
                  <input
                    type="text"
                    value={mintInput}
                    onChange={(event) => setMintInput(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && void handleLoad()}
                    placeholder="Load a stablecoin by mint address"
                    className="input-field max-w-2xl"
                    disabled={!stablecoin.ready}
                  />
                  <div className="flex gap-3">
                    <button
                      onClick={() => void handleLoad()}
                      disabled={!stablecoin.ready || !mintInput.trim() || stablecoin.loading}
                      className="btn-primary"
                    >
                      {stablecoin.loading ? "Loading..." : "Load"}
                    </button>
                    {stablecoin.config && (
                      <button onClick={() => void refreshStats()} className="btn-secondary">
                        Refresh
                      </button>
                    )}
                  </div>
                </div>
                {loadError && <p className="mt-2 text-sm text-red-300">{loadError}</p>}
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="status-tile">
                  <span className="status-tile-label">Wallet</span>
                  <span className={wallet.connected ? "badge-green" : "badge-yellow"}>
                    {wallet.connected ? "Connected" : "Read-only"}
                  </span>
                </div>
                <div className="status-tile">
                  <span className="status-tile-label">Preset</span>
                  <span
                    className={
                      stablecoin.config?.enablePermanentDelegate &&
                      stablecoin.config?.enableTransferHook
                        ? "badge-green"
                        : stablecoin.config
                          ? "badge-blue"
                          : "badge-muted"
                    }
                  >
                    {stablecoin.config
                      ? stablecoin.config.enablePermanentDelegate &&
                        stablecoin.config.enableTransferHook
                        ? "SSS-2"
                        : stablecoin.config.enablePermanentDelegate ||
                            stablecoin.config.enableTransferHook
                          ? "Custom"
                          : "SSS-1"
                      : "Unloaded"}
                  </span>
                </div>
                <div className="status-tile">
                  <span className="status-tile-label">Runtime</span>
                  <span className={stablecoin.config?.paused ? "badge-red" : "badge-green"}>
                    {stablecoin.config?.paused ? "Paused" : "Active"}
                  </span>
                </div>
                <div className="status-tile">
                  <span className="status-tile-label">Telemetry</span>
                  <span
                    className={
                      stablecoin.backendBaseUrl
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

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {stablecoin.config && (
                  <>
                    <span className="badge-muted">
                      {stablecoin.config.symbol} operator surface
                    </span>
                    <span className="badge-muted">
                      RPC: {stablecoin.rpcEndpoint.replace(/^https?:\/\//, "")}
                    </span>
                    {stablecoin.backendBaseUrl && (
                      <span className="badge-muted">
                        Backend: {stablecoin.backendBaseUrl.replace(/^https?:\/\//, "")}
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
            {!wallet.connected && (
              <p className="text-sm text-amber-200">
                Connect a wallet to execute admin instructions. Overview and audit panels stay
                available without a signer.
              </p>
            )}
          </div>
        </header>

        <div className="mx-auto max-w-7xl p-6 md:p-8">
          {activeView === "dashboard" && (
            <Dashboard
              config={stablecoin.config}
              configAddress={stablecoin.configAddress}
              mintAddress={stablecoin.mintAddress}
              supply={supply}
              roleCount={roleCount}
              minterCount={minterCount}
              blacklistCount={blacklistCount}
              timelineIncidents={timelineIncidents}
              webhookOverview={webhookOverview}
              snapshots={snapshots}
              snapshotDiff={snapshotDiff}
              onCreateSnapshot={handleCreateSnapshot}
              onRedeliverIncident={stablecoin.redeliverIncident}
              onRedeliverDelivery={stablecoin.redeliverDelivery}
              backendBaseUrl={stablecoin.backendBaseUrl}
              lastOperatorAction={lastOperatorAction}
              lastRefreshedAt={lastRefreshedAt}
              rpcEndpoint={stablecoin.rpcEndpoint}
            />
          )}

          {activeView === "mint-burn" && (
            <MintBurn
              config={
                stablecoin.config
                  ? {
                      decimals: stablecoin.config.decimals,
                      paused: stablecoin.config.paused,
                      symbol: stablecoin.config.symbol,
                    }
                  : null
              }
              mintAddress={stablecoin.mintAddress}
              onMint={(recipient, amount) =>
                runTrackedAction("mint", stablecoin.mintTokens, recipient, amount)
              }
              onBurn={(fromAccount, amount) =>
                runTrackedAction("burn", stablecoin.burnTokens, fromAccount, amount)
              }
            />
          )}

          {activeView === "roles" && (
            <Roles
              config={
                stablecoin.config
                  ? {
                      enableTransferHook: stablecoin.config.enableTransferHook,
                      enablePermanentDelegate: stablecoin.config.enablePermanentDelegate,
                    }
                  : null
              }
              onUpdateRole={(roleType, user, active) =>
                runTrackedAction("role.update", stablecoin.updateRole, roleType, user, active)
              }
              onUpdateMinterQuota={(minter, quota) =>
                runTrackedAction("minter.update", stablecoin.updateMinterQuota, minter, quota)
              }
              fetchRoles={stablecoin.fetchRoles}
              fetchMinterQuotas={stablecoin.fetchMinterQuotas}
            />
          )}

          {activeView === "freeze-thaw" && (
            <FreezeThaw
              config={stablecoin.config ? { symbol: stablecoin.config.symbol } : null}
              onFreeze={(walletAddress) =>
                runTrackedAction("freeze", stablecoin.freezeAccount, walletAddress)
              }
              onThaw={(walletAddress) =>
                runTrackedAction("thaw", stablecoin.thawAccount, walletAddress)
              }
            />
          )}

          {activeView === "blacklist" && (
            <Blacklist
              config={
                stablecoin.config
                  ? {
                      enableTransferHook: stablecoin.config.enableTransferHook,
                    }
                  : null
              }
              onAdd={(address, reason) =>
                runTrackedAction("blacklist.add", stablecoin.addToBlacklist, address, reason)
              }
              onRemove={(address) =>
                runTrackedAction("blacklist.remove", stablecoin.removeFromBlacklist, address)
              }
              fetchBlacklist={stablecoin.fetchBlacklist}
            />
          )}

          {activeView === "pause" && (
            <PauseControl
              config={
                stablecoin.config
                  ? {
                      paused: stablecoin.config.paused,
                      symbol: stablecoin.config.symbol,
                    }
                  : null
              }
              onPause={() => runTrackedAction("pause", stablecoin.pauseStablecoin)}
              onUnpause={() => runTrackedAction("unpause", stablecoin.unpauseStablecoin)}
            />
          )}

          {activeView === "seize" && (
            <Seize
              config={
                stablecoin.config
                  ? {
                      enablePermanentDelegate: stablecoin.config.enablePermanentDelegate,
                    }
                  : null
              }
              onSeize={(fromOwner, toOwner, amount) =>
                runTrackedAction("seize", stablecoin.seizeTokens, fromOwner, toOwner, amount)
              }
            />
          )}
        </div>
      </main>
    </div>
  );
}
