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
import { useStablecoin } from "@/hooks/useStablecoin";

type ViewType =
  | "dashboard"
  | "mint-burn"
  | "roles"
  | "freeze-thaw"
  | "blacklist"
  | "pause";

export default function Home() {
  const wallet = useWallet();
  const stablecoin = useStablecoin();
  const [activeView, setActiveView] = useState<ViewType>("dashboard");
  const [mintInput, setMintInput] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  // Data for dashboard
  const [supply, setSupply] = useState("0");
  const [roleCount, setRoleCount] = useState(0);
  const [blacklistCount, setBlacklistCount] = useState(0);

  // Load dashboard stats when config changes
  const refreshStats = useCallback(async () => {
    if (!stablecoin.config) return;
    try {
      const [s, roles, bl] = await Promise.all([
        stablecoin.fetchSupply(),
        stablecoin.fetchRoles(),
        stablecoin.fetchBlacklist(),
      ]);
      setSupply(s);
      setRoleCount(roles.filter((r) => r.active).length);
      setBlacklistCount(bl.length);
    } catch {
      // Non-critical — dashboard will show stale data
    }
  }, [stablecoin]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Handle loading a stablecoin
  const handleLoad = async () => {
    if (!mintInput.trim()) return;
    setLoadError(null);
    try {
      await stablecoin.loadStablecoin(mintInput.trim());
      await refreshStats();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <Sidebar activeView={activeView} onViewChange={(v) => setActiveView(v as ViewType)} />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {/* Top bar */}
        <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/80 px-8 py-4 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={mintInput}
                  onChange={(e) => setMintInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleLoad()}
                  placeholder="Enter mint address to load stablecoin..."
                  className="input-field max-w-lg"
                  disabled={!stablecoin.ready}
                />
                <button
                  onClick={handleLoad}
                  disabled={!stablecoin.ready || !mintInput.trim() || stablecoin.loading}
                  className="btn-primary"
                >
                  {stablecoin.loading ? "Loading..." : "Load"}
                </button>
                {stablecoin.config && (
                  <button onClick={refreshStats} className="btn-secondary">
                    Refresh
                  </button>
                )}
              </div>
              {loadError && (
                <p className="mt-1 text-sm text-red-400">{loadError}</p>
              )}
            </div>

            {/* Config info */}
            {stablecoin.config && (
              <div className="flex items-center gap-3">
                <span className="badge-blue">
                  {stablecoin.config.symbol}
                </span>
                {stablecoin.config.enableTransferHook &&
                stablecoin.config.enablePermanentDelegate ? (
                  <span className="badge-green">SSS-2</span>
                ) : (
                  <span className="badge-blue">SSS-1</span>
                )}
                {stablecoin.config.paused && (
                  <span className="badge-red">PAUSED</span>
                )}
              </div>
            )}
          </div>

          {/* Connection status */}
          {!wallet.connected && (
            <p className="mt-2 text-sm text-yellow-400">
              Connect your wallet to interact with the stablecoin.
            </p>
          )}
        </header>

        {/* View content */}
        <div className="p-8">
          {activeView === "dashboard" && (
            <Dashboard
              config={stablecoin.config}
              configAddress={stablecoin.configAddress}
              mintAddress={stablecoin.mintAddress}
              supply={supply}
              roleCount={roleCount}
              blacklistCount={blacklistCount}
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
              onMint={stablecoin.mintTokens}
              onBurn={stablecoin.burnTokens}
            />
          )}

          {activeView === "roles" && (
            <Roles
              config={
                stablecoin.config
                  ? {
                      enableTransferHook: stablecoin.config.enableTransferHook,
                      enablePermanentDelegate:
                        stablecoin.config.enablePermanentDelegate,
                    }
                  : null
              }
              onUpdateRole={stablecoin.updateRole}
              onUpdateMinterQuota={stablecoin.updateMinterQuota}
              fetchRoles={stablecoin.fetchRoles}
              fetchMinterQuotas={stablecoin.fetchMinterQuotas}
            />
          )}

          {activeView === "freeze-thaw" && (
            <FreezeThaw
              config={
                stablecoin.config
                  ? { symbol: stablecoin.config.symbol }
                  : null
              }
              onFreeze={stablecoin.freezeAccount}
              onThaw={stablecoin.thawAccount}
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
              onAdd={stablecoin.addToBlacklist}
              onRemove={stablecoin.removeFromBlacklist}
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
              onPause={stablecoin.pauseStablecoin}
              onUnpause={stablecoin.unpauseStablecoin}
            />
          )}
        </div>
      </main>
    </div>
  );
}
