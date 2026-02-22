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
      <div className="card">
        <h2 className="card-header">Blacklist Management</h2>
        <div className="flex min-h-[200px] items-center justify-center">
          <p className="text-gray-400">
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
      {/* Blacklist Table */}
      <div className="card">
        <div className="flex items-center justify-between">
          <h2 className="card-header">Blacklisted Addresses</h2>
          <button
            onClick={loadEntries}
            className="btn-secondary"
            disabled={listLoading}
          >
            {listLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {entries.length === 0 ? (
          <p className="py-8 text-center text-gray-500">
            No blacklisted addresses
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-700 text-gray-400">
                  <th className="pb-3 pr-4 font-medium">Address</th>
                  <th className="pb-3 pr-4 font-medium">Reason</th>
                  <th className="pb-3 pr-4 font-medium">Date</th>
                  <th className="pb-3 font-medium">Added By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {entries.map((entry, idx) => (
                  <tr key={idx} className="text-gray-300">
                    <td className="py-3 pr-4 font-mono">
                      {truncateAddress(entry.address.toBase58())}
                    </td>
                    <td className="py-3 pr-4">{entry.reason}</td>
                    <td className="py-3 pr-4">
                      {formatTimestamp(entry.blacklistedAt)}
                    </td>
                    <td className="py-3 font-mono">
                      {truncateAddress(entry.blacklistedBy.toBase58())}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Remove Forms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Add to Blacklist */}
        <div className="card">
          <h2 className="card-header">Add to Blacklist</h2>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <input
                type="text"
                className="input-field"
                placeholder="Address to blacklist"
                value={addAddress}
                onChange={(e) => setAddAddress(e.target.value)}
                disabled={addLoading}
              />
            </div>
            <div>
              <input
                type="text"
                className="input-field"
                placeholder="Reason for blacklisting"
                value={addReason}
                onChange={(e) => setAddReason(e.target.value)}
                disabled={addLoading}
              />
            </div>
            <button
              type="submit"
              className="btn-danger w-full"
              disabled={addLoading || !addAddress || !addReason}
            >
              {addLoading ? "Adding..." : "Add to Blacklist"}
            </button>
            {addResult && (
              <p
                className={
                  addResult.type === "success"
                    ? "text-sm text-green-400"
                    : "text-sm text-red-400"
                }
              >
                {addResult.message}
              </p>
            )}
          </form>
        </div>

        {/* Remove from Blacklist */}
        <div className="card">
          <h2 className="card-header">Remove from Blacklist</h2>
          <form onSubmit={handleRemove} className="space-y-4">
            <div>
              <input
                type="text"
                className="input-field"
                placeholder="Address to remove"
                value={removeAddress}
                onChange={(e) => setRemoveAddress(e.target.value)}
                disabled={removeLoading}
              />
            </div>
            <button
              type="submit"
              className="btn-secondary w-full"
              disabled={removeLoading || !removeAddress}
            >
              {removeLoading ? "Removing..." : "Remove from Blacklist"}
            </button>
            {removeResult && (
              <p
                className={
                  removeResult.type === "success"
                    ? "text-sm text-green-400"
                    : "text-sm text-red-400"
                }
              >
                {removeResult.message}
              </p>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
