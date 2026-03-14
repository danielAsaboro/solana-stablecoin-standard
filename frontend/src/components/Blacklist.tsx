"use client";

import { useState, useEffect, FormEvent } from "react";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { truncateAddress } from "@/lib/constants";

interface BlacklistEntryData {
  address: PublicKey;
  reason: string;
  blacklistedAt: BN;
  blacklistedBy: PublicKey;
}

interface BlacklistProps {
  config: { enableTransferHook: boolean } | null;
  onAdd: (address: string, reason: string) => Promise<string>;
  onRemove: (address: string) => Promise<string>;
  fetchBlacklist: () => Promise<BlacklistEntryData[]>;
}

interface FormResult {
  type: "success" | "error";
  message: string;
}

function truncateSig(sig: string): string {
  if (sig.length <= 16) return sig;
  return `${sig.slice(0, 8)}...${sig.slice(-8)}`;
}

function formatTimestamp(bn: BN): string {
  const ms = bn.toNumber() * 1000;
  return new Date(ms).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function Blacklist({
  config,
  onAdd,
  onRemove,
  fetchBlacklist,
}: BlacklistProps) {
  const [entries, setEntries] = useState<BlacklistEntryData[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [addAddress, setAddAddress] = useState("");
  const [addReason, setAddReason] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addResult, setAddResult] = useState<FormResult | null>(null);

  const [removeAddress, setRemoveAddress] = useState("");
  const [removeLoading, setRemoveLoading] = useState(false);
  const [removeResult, setRemoveResult] = useState<FormResult | null>(null);

  async function loadEntries() {
    setListLoading(true);
    try {
      const data = await fetchBlacklist();
      setEntries(data);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to fetch blacklist";
      setAddResult({ type: "error", message });
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    if (config?.enableTransferHook) {
      loadEntries();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.enableTransferHook]);

  if (!config || !config.enableTransferHook) {
    return (
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Compliance</p>
            <h2 className="panel-title">Blacklist Management</h2>
          </div>
        </div>
        <div className="empty-state">
          <p className="text-center text-sm text-slate-400">
            Blacklist is only available on SSS-2 stablecoins
          </p>
        </div>
      </div>
    );
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    setAddResult(null);

    try {
      const sig = await onAdd(addAddress, addReason);
      setAddResult({
        type: "success",
        message: `Address blacklisted. Tx: ${truncateSig(sig)}`,
      });
      setAddAddress("");
      setAddReason("");
      await loadEntries();
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to add to blacklist";
      setAddResult({ type: "error", message });
    } finally {
      setAddLoading(false);
    }
  }

  async function handleRemove(e: FormEvent) {
    e.preventDefault();
    setRemoveLoading(true);
    setRemoveResult(null);

    try {
      const sig = await onRemove(removeAddress);
      setRemoveResult({
        type: "success",
        message: `Address removed from blacklist. Tx: ${truncateSig(sig)}`,
      });
      setRemoveAddress("");
      await loadEntries();
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to remove from blacklist";
      setRemoveResult({ type: "error", message });
    } finally {
      setRemoveLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Blacklisted Addresses */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Restricted Addresses</p>
            <h2 className="panel-title">Blacklisted Addresses</h2>
          </div>
          <button
            onClick={loadEntries}
            className="btn-secondary"
            disabled={listLoading}
          >
            {listLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="empty-state">
            <p className="text-center text-sm text-slate-400">
              No blacklisted addresses
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {entries.map((entry, idx) => (
              <div key={idx} className="activity-row">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-mono text-sm text-white">
                      {truncateAddress(entry.address.toBase58())}
                    </p>
                    <p className="text-sm text-slate-400">{entry.reason}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">
                      {formatTimestamp(entry.blacklistedAt)}
                    </p>
                    <p className="font-mono text-xs text-slate-600">
                      by {truncateAddress(entry.blacklistedBy.toBase58())}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Remove Forms */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Restrict Access</p>
              <h2 className="panel-title">Add to Blacklist</h2>
            </div>
          </div>
          <form onSubmit={handleAdd} className="space-y-4">
            <input
              type="text"
              className="input-field"
              placeholder="Address to blacklist"
              value={addAddress}
              onChange={(e) => setAddAddress(e.target.value)}
              disabled={addLoading}
            />
            <input
              type="text"
              className="input-field"
              placeholder="Reason for blacklisting"
              value={addReason}
              onChange={(e) => setAddReason(e.target.value)}
              disabled={addLoading}
            />
            <button
              type="submit"
              className="btn-danger w-full"
              disabled={addLoading || !addAddress || !addReason}
            >
              {addLoading ? "Adding..." : "Add to Blacklist"}
            </button>
            {addResult && (
              <div className={`alert-panel ${addResult.type === "success" ? "alert-success" : "alert-critical"}`}>
                <p className={`text-sm ${addResult.type === "success" ? "text-emerald-200" : "text-rose-200"}`}>
                  {addResult.message}
                </p>
              </div>
            )}
          </form>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Restore Access</p>
              <h2 className="panel-title">Remove from Blacklist</h2>
            </div>
          </div>
          <form onSubmit={handleRemove} className="space-y-4">
            <input
              type="text"
              className="input-field"
              placeholder="Address to remove"
              value={removeAddress}
              onChange={(e) => setRemoveAddress(e.target.value)}
              disabled={removeLoading}
            />
            <button
              type="submit"
              className="btn-secondary w-full"
              disabled={removeLoading || !removeAddress}
            >
              {removeLoading ? "Removing..." : "Remove from Blacklist"}
            </button>
            {removeResult && (
              <div className={`alert-panel ${removeResult.type === "success" ? "alert-success" : "alert-critical"}`}>
                <p className={`text-sm ${removeResult.type === "success" ? "text-emerald-200" : "text-rose-200"}`}>
                  {removeResult.message}
                </p>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
