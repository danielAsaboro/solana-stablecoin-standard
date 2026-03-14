"use client";

import { useCallback, useEffect, useState } from "react";
import { useSolanaWallet } from "@/hooks/usePrivySolana";
import Sidebar from "@/components/Sidebar";
import Header from "@/components/Header";
import MobileDrawer from "@/components/MobileDrawer";
import ConnectHero from "@/components/ConnectHero";
import Dashboard from "@/components/Dashboard";
import MintBurn from "@/components/MintBurn";
import Roles from "@/components/Roles";
import FreezeThaw from "@/components/FreezeThaw";
import Blacklist from "@/components/Blacklist";
import PauseControl from "@/components/PauseControl";
import Seize from "@/components/Seize";
import DemoWizard from "@/components/DemoWizard";
import Initialize from "@/components/Initialize";
import Transfer from "@/components/Transfer";
import AuditLog from "@/components/AuditLog";
import {
  useStablecoin,
  type OperatorTimelineIncident,
  type OperatorSnapshotDiff,
  type OperatorSnapshotRecord,
  type WebhookOverview,
} from "@/hooks/useStablecoin";

type ViewType =
  | "demo"
  | "dashboard"
  | "initialize"
  | "mint-burn"
  | "transfer"
  | "roles"
  | "freeze-thaw"
  | "blacklist"
  | "pause"
  | "seize"
  | "audit";

export default function Home() {
  const wallet = useSolanaWallet();
  const stablecoin = useStablecoin();
  const [activeView, setActiveView] = useState<ViewType>("dashboard");
  const [mintInput, setMintInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [heroSkipped, setHeroSkipped] = useState(false);

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

  const showHero = !wallet.connected && !stablecoin.config && !heroSkipped;

  return (
    <div className="flex min-h-screen overflow-hidden bg-shell">
      <Sidebar
        activeView={activeView}
        onViewChange={(view) => setActiveView(view as ViewType)}
        statusLabel={telemetryLabel}
        symbol={stablecoin.config?.symbol ?? null}
        paused={stablecoin.config?.paused ?? false}
      />

      <MobileDrawer
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        activeView={activeView}
        onViewChange={(view) => setActiveView(view as ViewType)}
      />

      <main className="flex-1 overflow-y-auto">
        <Header
          mintInput={mintInput}
          onMintInputChange={setMintInput}
          onLoad={() => void handleLoad()}
          onRefresh={() => void refreshStats()}
          loading={stablecoin.loading}
          ready={stablecoin.ready}
          loadError={loadError}
          statsError={statsError}
          config={
            stablecoin.config
              ? {
                  symbol: stablecoin.config.symbol,
                  paused: stablecoin.config.paused,
                  enablePermanentDelegate: stablecoin.config.enablePermanentDelegate,
                  enableTransferHook: stablecoin.config.enableTransferHook,
                }
              : null
          }
          rpcEndpoint={stablecoin.rpcEndpoint}
          backendBaseUrl={stablecoin.backendBaseUrl}
          webhookOverview={webhookOverview}
          telemetryLabel={telemetryLabel}
          lastRefreshedAt={lastRefreshedAt}
          lastOperatorAction={lastOperatorAction}
          walletConnected={wallet.connected}
          onToggleMobileMenu={() => setMobileMenuOpen((prev) => !prev)}
        />

        <div className="mx-auto max-w-7xl p-6 md:p-8">
          {showHero ? (
            <ConnectHero onSkip={() => setHeroSkipped(true)} />
          ) : (
            <>
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

              {activeView === "demo" && (
                <DemoWizard
                  onComplete={(mintAddr) => {
                    setMintInput(mintAddr);
                    void stablecoin.loadStablecoin(mintAddr).then(() => {
                      void refreshStats();
                      setActiveView("dashboard");
                    });
                  }}
                />
              )}

              {activeView === "initialize" && (
                <Initialize
                  onCreated={(mintAddr) => {
                    setMintInput(mintAddr);
                    void stablecoin.loadStablecoin(mintAddr).then(() => {
                      void refreshStats();
                      setActiveView("dashboard");
                    });
                  }}
                />
              )}

              {activeView === "transfer" && (
                <Transfer mintAddress={stablecoin.mintAddress} decimals={stablecoin.config?.decimals ?? 6} />
              )}

              {activeView === "audit" && (
                <AuditLog configAddress={stablecoin.configAddress} />
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
