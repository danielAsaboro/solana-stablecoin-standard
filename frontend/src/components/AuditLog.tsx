"use client";

import { FC, useCallback, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { useSolanaConnection } from "@/hooks/usePrivySolana";
import { useSDK } from "@/hooks/useSDK";
import { type SSSEvent, SSSEventName } from "@stbr/sss-core-sdk";
import { truncateAddress } from "@/lib/constants";

interface AuditLogProps {
  configAddress: PublicKey | null;
}

interface AuditEntry {
  signature: string;
  slot: number;
  blockTime: number | null;
  events: SSSEvent[];
}

const EVENT_COLORS: Record<string, string> = {
  [SSSEventName.StablecoinInitialized]: "badge-blue",
  [SSSEventName.TokensMinted]: "badge-green",
  [SSSEventName.TokensBurned]: "badge-yellow",
  [SSSEventName.AccountFrozen]: "badge-blue",
  [SSSEventName.AccountThawed]: "badge-blue",
  [SSSEventName.StablecoinPaused]: "badge-red",
  [SSSEventName.StablecoinUnpaused]: "badge-green",
  [SSSEventName.RoleUpdated]: "badge-muted",
  [SSSEventName.MinterQuotaUpdated]: "badge-muted",
  [SSSEventName.AuthorityTransferred]: "badge-yellow",
  [SSSEventName.AddressBlacklisted]: "badge-red",
  [SSSEventName.AddressUnblacklisted]: "badge-green",
  [SSSEventName.TokensSeized]: "badge-red",
};

const AuditLog: FC<AuditLogProps> = ({ configAddress }) => {
  const { connection } = useSolanaConnection();
  const sdk = useSDK();

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const fetchAuditLog = useCallback(async () => {
    if (!configAddress) return;
    setLoading(true);
    setError(null);

    try {
      const signatures = await connection.getSignaturesForAddress(
        configAddress,
        { limit: 50 },
        "confirmed"
      );

      const auditEntries: AuditEntry[] = [];

      for (const sigInfo of signatures) {
        try {
          const events = await sdk.parseEvents(sigInfo.signature);
          auditEntries.push({
            signature: sigInfo.signature,
            slot: sigInfo.slot,
            blockTime: sigInfo.blockTime ?? null,
            events,
          });
        } catch {
          auditEntries.push({
            signature: sigInfo.signature,
            slot: sigInfo.slot,
            blockTime: sigInfo.blockTime ?? null,
            events: [],
          });
        }
      }

      setEntries(auditEntries);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [configAddress, connection, sdk]);

  useEffect(() => {
    void fetchAuditLog();
  }, [fetchAuditLog]);

  if (!configAddress) {
    return (
      <div className="panel">
        <div className="empty-state">
          <p className="text-center text-sm text-slate-400">
            Load a stablecoin first to view its audit log.
          </p>
        </div>
      </div>
    );
  }

  const allEventNames = Object.values(SSSEventName);
  const filteredEntries =
    filter === "all"
      ? entries
      : entries.filter((e) => e.events.some((ev) => ev.name === filter));

  return (
    <div className="space-y-6">
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">On-Chain Events</p>
            <h2 className="panel-title">Audit Log</h2>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void fetchAuditLog()} className="btn-secondary" disabled={loading}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setFilter("all")}
            className={filter === "all" ? "badge-blue" : "badge-muted cursor-pointer"}
          >
            All
          </button>
          {allEventNames.map((eventName) => (
            <button
              key={eventName}
              onClick={() => setFilter(eventName)}
              className={filter === eventName ? "badge-blue" : "badge-muted cursor-pointer"}
            >
              {eventName}
            </button>
          ))}
        </div>

        {error && (
          <div className="alert-panel alert-critical mb-4">
            <p className="text-sm text-rose-200">{error}</p>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-12">
            <svg className="h-6 w-6 animate-spin text-brand-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="ml-3 text-sm text-slate-400">Loading audit log...</span>
          </div>
        )}

        {filteredEntries.length === 0 && !loading && (
          <div className="empty-state">
            <p className="text-center text-sm text-slate-400">
              {entries.length === 0
                ? "No transactions found for this stablecoin."
                : "No events match this filter."}
            </p>
          </div>
        )}

        <div className="space-y-3">
          {filteredEntries.map((entry) => (
            <div key={entry.signature} className="activity-row">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {entry.events.length > 0 ? (
                      entry.events.map((event, i) => (
                        <span
                          key={i}
                          className={EVENT_COLORS[event.name] ?? "badge-muted"}
                        >
                          {event.name}
                        </span>
                      ))
                    ) : (
                      <span className="badge-muted">No parsed events</span>
                    )}
                  </div>
                  {entry.events.map((event, i) => (
                    <p key={i} className="text-xs text-slate-400 font-mono">
                      {formatEventData(event)}
                    </p>
                  ))}
                </div>
                <div className="text-right">
                  <p className="font-mono text-xs text-slate-400">
                    {truncateAddress(entry.signature, 8)}
                  </p>
                  {entry.blockTime && (
                    <p className="text-xs text-slate-500">
                      {new Date(entry.blockTime * 1000).toLocaleString()}
                    </p>
                  )}
                  <p className="text-xs text-slate-600">Slot {entry.slot}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

function formatEventData(event: SSSEvent): string {
  const data = event.data as unknown as Record<string, unknown>;
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof PublicKey) {
      parts.push(`${key}: ${truncateAddress(value.toBase58())}`);
    } else if (typeof value === "object" && value !== null && "toString" in value) {
      parts.push(`${key}: ${value.toString()}`);
    } else {
      parts.push(`${key}: ${String(value)}`);
    }
  }
  return parts.join(" | ");
}

export default AuditLog;
