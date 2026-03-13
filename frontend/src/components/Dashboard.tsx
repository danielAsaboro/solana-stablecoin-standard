"use client";

import { useState } from "react";
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import {
  type OperatorTimelineIncident,
  type OperatorSnapshotDiff,
  type OperatorSnapshotRecord,
  type OperatorTimelineSeverity,
  type OperatorTimelineSource,
  type WebhookDeliverySnapshot,
  type WebhookOverview,
} from "@/hooks/useStablecoin";
import { formatTokenAmount, truncateAddress } from "@/lib/constants";

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
  minterCount: number;
  blacklistCount: number;
  timelineIncidents: Array<OperatorTimelineIncident>;
  webhookOverview: WebhookOverview | null;
  snapshots: Array<OperatorSnapshotRecord>;
  snapshotDiff: OperatorSnapshotDiff | null;
  onCreateSnapshot: () => Promise<OperatorSnapshotRecord | null>;
  onRedeliverIncident: (
    incidentId: string,
    webhookId?: string
  ) => Promise<Array<WebhookDeliverySnapshot>>;
  onRedeliverDelivery: (deliveryId: string) => Promise<WebhookDeliverySnapshot | null>;
  backendBaseUrl: string | null;
  lastOperatorAction: {
    action: string;
    signature: string;
    occurredAt: string;
  } | null;
  lastRefreshedAt: string | null;
  rpcEndpoint: string;
}

function CopyButton({ text }: { text: string }) {
  return (
    <button
      onClick={() => navigator.clipboard.writeText(text)}
      className="ml-2 text-slate-500 transition-colors hover:text-slate-200"
      title="Copy to clipboard"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
        />
      </svg>
    </button>
  );
}

function detectExplorerCluster(rpcEndpoint: string): string | undefined {
  const lower = rpcEndpoint.toLowerCase();
  if (lower.includes("devnet")) return "devnet";
  if (lower.includes("testnet")) return "testnet";
  if (lower.includes("mainnet") || lower.includes("mainnet-beta")) return undefined;
  return `custom&customUrl=${encodeURIComponent(rpcEndpoint)}`;
}

function explorerTransactionUrl(signature: string, rpcEndpoint: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  const cluster = detectExplorerCluster(rpcEndpoint);
  return cluster ? `${base}?cluster=${cluster}` : base;
}

function presetBadge(
  enablePermanentDelegate: boolean,
  enableTransferHook: boolean
): { label: string; tone: string } {
  if (enablePermanentDelegate && enableTransferHook) {
    return { label: "SSS-2", tone: "badge-green" };
  }
  if (!enablePermanentDelegate && !enableTransferHook) {
    return { label: "SSS-1", tone: "badge-blue" };
  }
  return { label: "Custom", tone: "badge-yellow" };
}

function statusTone(severity: OperatorTimelineSeverity): string {
  switch (severity) {
    case "critical":
      return "status-pill-critical";
    case "warning":
      return "status-pill-warning";
    case "info":
      return "status-pill-neutral";
    default:
      return "status-pill-success";
  }
}

function summaryTone({
  paused,
  blacklistCount,
}: {
  paused: boolean;
  blacklistCount: number;
}): { title: string; description: string; className: string } {
  if (paused) {
    return {
      title: "Emergency halt active",
      description: "Mint and burn are blocked until an operator explicitly unpauses the stablecoin.",
      className: "alert-critical",
    };
  }

  if (blacklistCount > 0) {
    return {
      title: "Compliance watch active",
      description: `${blacklistCount} address${blacklistCount === 1 ? "" : "es"} currently restricted.`,
      className: "alert-warning",
    };
  }

  return {
    title: "Operating normally",
    description: "No emergency pause is active and no current compliance alert requires immediate intervention.",
    className: "alert-success",
  };
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: "success" | "warning" | "critical" | "neutral";
}) {
  return (
    <div className={`metric-card metric-card-${tone}`}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">{value}</p>
      <p className="metric-detail">{detail}</p>
    </div>
  );
}

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-800/80 py-3 last:border-b-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="flex items-center font-mono text-sm text-slate-100">
        {truncateAddress(value)}
        <CopyButton text={value} />
      </span>
    </div>
  );
}

export default function Dashboard({
  config,
  configAddress,
  mintAddress,
  supply,
  roleCount,
  minterCount,
  blacklistCount,
  timelineIncidents,
  webhookOverview,
  snapshots,
  snapshotDiff,
  onCreateSnapshot,
  onRedeliverIncident,
  onRedeliverDelivery,
  backendBaseUrl,
  lastOperatorAction,
  lastRefreshedAt,
  rpcEndpoint,
}: DashboardProps) {
  const [sourceFilter, setSourceFilter] = useState<OperatorTimelineSource | "all">("all");
  const [severityFilter, setSeverityFilter] = useState<OperatorTimelineSeverity | "all">("all");
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [addressFilter, setAddressFilter] = useState("");
  const [authorityFilter, setAuthorityFilter] = useState("");
  const [signatureFilter, setSignatureFilter] = useState("");
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);
  const [replayMessage, setReplayMessage] = useState<string | null>(null);

  if (!config) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10">
        <div className="max-w-lg text-center">
          <p className="eyebrow">Overview First</p>
          <h2 className="mt-3 text-3xl font-semibold text-white">Load a stablecoin to open the console</h2>
          <p className="mt-4 text-base text-slate-400">
            The dashboard is designed to start with posture, risk, and audit visibility before you
            move into action-specific controls.
          </p>
        </div>
      </div>
    );
  }

  const preset = presetBadge(
    config.enablePermanentDelegate,
    config.enableTransferHook
  );
  const runtimeSummary = summaryTone({
    paused: config.paused,
    blacklistCount,
  });
  const netSupply = config.totalMinted.sub(config.totalBurned);
  const filteredIncidents = timelineIncidents.filter((incident) => {
    const sourceMatch =
      sourceFilter === "all" || incident.sources.includes(sourceFilter);
    const severityMatch =
      severityFilter === "all" || incident.severity === severityFilter;
    const actionMatch = actionFilter === "all" || incident.action === actionFilter;
    const statusMatch = statusFilter === "all" || incident.status === statusFilter;
    const addressMatch =
      !addressFilter ||
      incident.targetAddress?.includes(addressFilter) ||
      incident.summary.includes(addressFilter);
    const authorityMatch =
      !authorityFilter || incident.authority?.includes(authorityFilter);
    const signatureMatch =
      !signatureFilter || incident.signature?.includes(signatureFilter);
    return (
      sourceMatch &&
      severityMatch &&
      actionMatch &&
      statusMatch &&
      Boolean(addressMatch) &&
      Boolean(authorityMatch) &&
      Boolean(signatureMatch)
    );
  });
  const actionOptions = Array.from(
    new Set(timelineIncidents.map((incident) => incident.action))
  ).sort();
  const selectedIncident =
    filteredIncidents.find((incident) => incident.id === selectedIncidentId) ??
    filteredIncidents[0] ??
    null;

  async function handleCreateSnapshot() {
    try {
      const snapshot = await onCreateSnapshot();
      setSnapshotMessage(
        snapshot ? `Snapshot created at ${new Date(snapshot.createdAt).toLocaleString()}` : null
      );
    } catch (error: unknown) {
      setSnapshotMessage(error instanceof Error ? error.message : "Snapshot creation failed");
    }
  }

  async function handleIncidentReplay(incidentId: string) {
    try {
      const deliveries = await onRedeliverIncident(incidentId);
      setReplayMessage(
        deliveries.length > 0
          ? `Queued ${deliveries.length} delivery replay${deliveries.length === 1 ? "" : "s"}`
          : "No matching deliveries found for replay"
      );
    } catch (error: unknown) {
      setReplayMessage(error instanceof Error ? error.message : "Incident replay failed");
    }
  }

  async function handleDeliveryReplay(deliveryId: string) {
    try {
      const delivery = await onRedeliverDelivery(deliveryId);
      setReplayMessage(
        delivery ? `Queued replay for ${delivery.eventType} (${delivery.id})` : "Replay unavailable"
      );
    } catch (error: unknown) {
      setReplayMessage(error instanceof Error ? error.message : "Delivery replay failed");
    }
  }

  return (
    <div className="space-y-6">
      <section className={`alert-panel ${runtimeSummary.className}`}>
        <div>
          <p className="eyebrow">Operational Posture</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">{runtimeSummary.title}</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-300">{runtimeSummary.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={preset.tone}>{preset.label}</span>
          <span className={config.paused ? "badge-red" : "badge-green"}>
            {config.paused ? "Paused" : "Active"}
          </span>
          <span className={blacklistCount > 0 ? "badge-yellow" : "badge-muted"}>
            {blacklistCount > 0 ? `${blacklistCount} compliance flags` : "No current blacklist entries"}
          </span>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Live Supply"
          value={formatTokenAmount(supply, config.decimals)}
          detail={`Net minted exposure ${formatTokenAmount(netSupply.toString(), config.decimals)}`}
          tone="success"
        />
        <MetricCard
          label="Active Roles"
          value={String(roleCount)}
          detail="Authorities currently able to execute admin actions"
          tone="neutral"
        />
        <MetricCard
          label="Minter Quotas"
          value={String(minterCount)}
          detail="Configured minter quota accounts"
          tone={minterCount > 0 ? "success" : "warning"}
        />
        <MetricCard
          label="Compliance Risk"
          value={String(blacklistCount)}
          detail={blacklistCount > 0 ? "Restricted addresses require review" : "No active blacklist pressure"}
          tone={blacklistCount > 0 ? "critical" : "neutral"}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.8fr_1fr]">
        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Operator Timeline</p>
              <h3 className="panel-title">Correlated incident stream</h3>
            </div>
            <span className="badge-muted">
              {filteredIncidents.length > 0
                ? `${filteredIncidents.length} incidents`
                : "Awaiting activity"}
            </span>
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-3">
            <label className="text-sm text-slate-400">
              Source
              <select
                value={sourceFilter}
                onChange={(event) =>
                  setSourceFilter(event.target.value as OperatorTimelineSource | "all")
                }
                className="mt-2 input-field"
              >
                <option value="all">All sources</option>
                <option value="operations">Operations</option>
                <option value="indexer">Indexer</option>
                <option value="compliance">Compliance</option>
                <option value="webhook">Webhook</option>
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Severity
              <select
                value={severityFilter}
                onChange={(event) =>
                  setSeverityFilter(event.target.value as OperatorTimelineSeverity | "all")
                }
                className="mt-2 input-field"
              >
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="success">Success</option>
                <option value="info">Info</option>
              </select>
            </label>
            <label className="text-sm text-slate-400">
              Action
              <select
                value={actionFilter}
                onChange={(event) => setActionFilter(event.target.value)}
                className="mt-2 input-field"
              >
                <option value="all">All actions</option>
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-4">
            <label className="text-sm text-slate-400">
              Status
              <input
                value={statusFilter === "all" ? "" : statusFilter}
                onChange={(event) => setStatusFilter(event.target.value || "all")}
                className="mt-2 input-field"
                placeholder="paused, failed, restricted"
              />
            </label>
            <label className="text-sm text-slate-400">
              Target
              <input
                value={addressFilter}
                onChange={(event) => setAddressFilter(event.target.value)}
                className="mt-2 input-field"
                placeholder="wallet or mint"
              />
            </label>
            <label className="text-sm text-slate-400">
              Authority
              <input
                value={authorityFilter}
                onChange={(event) => setAuthorityFilter(event.target.value)}
                className="mt-2 input-field"
                placeholder="signer"
              />
            </label>
            <label className="text-sm text-slate-400">
              Signature
              <input
                value={signatureFilter}
                onChange={(event) => setSignatureFilter(event.target.value)}
                className="mt-2 input-field"
                placeholder="tx signature"
              />
            </label>
          </div>

          {backendBaseUrl && (
            <div className="mb-4 flex flex-wrap gap-2">
              <a
                href={`${backendBaseUrl}/api/v1/operator-timeline?format=jsonl`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                Export incidents JSONL
              </a>
              <a
                href={`${backendBaseUrl}/api/v1/operator-timeline?format=csv`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                Export incidents CSV
              </a>
              <a
                href={`${backendBaseUrl}/api/v1/operator-evidence`}
                target="_blank"
                rel="noreferrer"
                className="btn-secondary"
              >
                Export evidence bundle
              </a>
            </div>
          )}

          {filteredIncidents.length === 0 ? (
            <div className="empty-state">
              <p className="text-sm text-slate-300">No incidents match the current filters.</p>
              <p className="mt-2 text-sm text-slate-500">
                This stream groups operation, on-chain, compliance, and webhook records on the same
                correlation key when they represent the same incident lifecycle.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredIncidents.map((incident) => (
                <button
                  key={incident.id}
                  type="button"
                  onClick={() => setSelectedIncidentId(incident.id)}
                  className={`activity-row w-full text-left ${
                    selectedIncident?.id === incident.id ? "border-brand-500/40" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={statusTone(incident.severity)}>{incident.status}</span>
                        <span className="text-sm font-medium text-white">{incident.summary}</span>
                        {incident.sources.map((source) => (
                          <span key={source} className="badge-muted">
                            {source}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-sm text-slate-400">
                        {new Date(incident.occurredAt).toLocaleString()}
                      </p>
                    </div>
                    {incident.signature ? (
                      <a
                        href={explorerTransactionUrl(incident.signature, rpcEndpoint)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-brand-300 transition-colors hover:text-brand-200"
                      >
                        {truncateAddress(incident.signature)}
                      </a>
                    ) : (
                      <span className="badge-muted">{incident.relatedCount} records</span>
                    )}
                  </div>

                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <p className="text-sm text-slate-400">
                      <span className="text-slate-500">Authority:</span>{" "}
                      {incident.authority ? truncateAddress(incident.authority) : "Unknown"}
                    </p>
                    <p className="text-sm text-slate-400">
                      <span className="text-slate-500">Target:</span>{" "}
                      {incident.targetAddress ? truncateAddress(incident.targetAddress) : "N/A"}
                    </p>
                  </div>
                  {incident.records.length > 1 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {incident.records.map((record) => (
                        <span key={record.id} className="badge-muted">
                          {record.source}:{record.action}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Incident Detail</p>
                <h3 className="panel-title">Selected incident drill-down</h3>
              </div>
            </div>

            {!selectedIncident ? (
              <div className="empty-state">
                <p className="text-sm text-slate-300">Select an incident to inspect related records.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={statusTone(selectedIncident.severity)}>
                      {selectedIncident.status}
                    </span>
                    <span className="badge-muted">{selectedIncident.action}</span>
                    <span className="badge-muted">{selectedIncident.relatedCount} records</span>
                  </div>
                  <p className="mt-3 text-sm text-slate-300">{selectedIncident.summary}</p>
                  {selectedIncident.signature && (
                    <p className="mt-3 text-sm text-slate-400">
                      Tx:{" "}
                      <a
                        href={explorerTransactionUrl(selectedIncident.signature, rpcEndpoint)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-300 hover:text-brand-200"
                      >
                        {selectedIncident.signature}
                      </a>
                    </p>
                  )}
                  {backendBaseUrl && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button onClick={() => void handleIncidentReplay(selectedIncident.id)} className="btn-secondary">
                        Replay incident webhooks
                      </button>
                    </div>
                  )}
                </div>

                {selectedIncident.records.map((record) => (
                  <div key={record.id} className="activity-row">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={statusTone(record.severity)}>{record.status}</span>
                        <span className="badge-muted">{record.source}</span>
                        <span className="text-sm font-medium text-white">{record.summary}</span>
                      </div>
                      {record.source === "webhook" && (
                        <button
                          onClick={() => void handleDeliveryReplay(record.id)}
                          className="btn-secondary"
                        >
                          Replay
                        </button>
                      )}
                    </div>
                    <p className="mt-2 text-sm text-slate-500">
                      {new Date(record.occurredAt).toLocaleString()}
                    </p>
                    {record.details && (
                      <pre className="mt-3 overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/90 p-3 text-xs text-slate-300">
                        {JSON.stringify(record.details, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
                {replayMessage && <p className="text-sm text-emerald-300">{replayMessage}</p>}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Webhook Signing</p>
                <h3 className="panel-title">Operator delivery posture</h3>
              </div>
            </div>

            {!webhookOverview ? (
              <div className="empty-state">
                <p className="text-sm text-slate-300">Backend telemetry is not configured.</p>
                <p className="mt-2 text-sm text-slate-500">
                  Set <code className="rounded bg-slate-800 px-1.5 py-0.5">NEXT_PUBLIC_SSS_BACKEND_URL</code> to
                  expose webhook delivery and HMAC state in the console.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard
                    label="Registered"
                    value={String(webhookOverview.registeredCount)}
                    detail={`${webhookOverview.activeCount} active`}
                    tone={webhookOverview.registeredCount > 0 ? "success" : "warning"}
                  />
                  <MetricCard
                    label="Signing Enabled"
                    value={String(webhookOverview.signingEnabledCount)}
                    detail={webhookOverview.signatureHeader ?? "No signed hooks"}
                    tone={webhookOverview.signingEnabledCount > 0 ? "success" : "neutral"}
                  />
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <p className="text-sm text-slate-400">Telemetry source</p>
                  <p className="mt-1 text-sm font-medium text-white">
                    {webhookOverview.baseUrl?.replace(/^https?:\/\//, "")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className={webhookOverview.available ? "badge-green" : "badge-yellow"}>
                      {webhookOverview.available ? "Live" : "Unavailable"}
                    </span>
                    {webhookOverview.signatureAlgorithm && (
                      <span className="badge-muted">{webhookOverview.signatureAlgorithm}</span>
                    )}
                    {webhookOverview.indexedEvents !== null && (
                      <span className="badge-muted">{webhookOverview.indexedEvents} indexed events</span>
                    )}
                  </div>
                  {webhookOverview.error && (
                    <p className="mt-3 text-sm text-amber-300">{webhookOverview.error}</p>
                  )}
                  {webhookOverview.signatureHeader && (
                    <p className="mt-3 text-sm text-slate-400">
                      Verify the raw request body with{" "}
                      <span className="font-medium text-slate-200">
                        {webhookOverview.signatureHeader}
                      </span>
                      .
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  {webhookOverview.deliveries.length === 0 ? (
                    <p className="text-sm text-slate-500">No delivery attempts recorded yet.</p>
                  ) : (
                    webhookOverview.deliveries.map((delivery) => (
                      <div key={delivery.id} className="activity-row">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{delivery.eventType}</p>
                            <p className="text-sm text-slate-500">
                              {new Date(delivery.createdAt).toLocaleString()}
                            </p>
                          </div>
                          <span
                            className={
                              delivery.status === "failed"
                                ? "status-pill-critical"
                                : delivery.status === "pending"
                                  ? "status-pill-warning"
                                  : "status-pill-success"
                            }
                          >
                            {delivery.status}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-slate-400">
                          Attempts {delivery.attempts}
                          {delivery.retryScheduled ? " • retry queued" : ""}
                          {delivery.finalized ? " • finalized" : ""}
                          {delivery.replayedFrom ? ` • replay of ${delivery.replayedFrom}` : ""}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Refresh State</p>
                <h3 className="panel-title">Console timing</h3>
              </div>
            </div>
            <div className="space-y-3 text-sm text-slate-300">
              <p>
                Last operator refresh:{" "}
                <span className="text-white">
                  {lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleString() : "Not yet refreshed"}
                </span>
              </p>
              <p>
                Default audit source:{" "}
                <span className="text-white">
                  {webhookOverview ? "Backend indexed events with webhook telemetry" : "Direct RPC event parsing"}
                </span>
              </p>
              {lastOperatorAction && (
                <p>
                  Last action correlation:{" "}
                  <span className="font-mono text-white">{lastOperatorAction.signature}</span>
                </p>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Snapshots</p>
                <h3 className="panel-title">Evidence and drift</h3>
              </div>
            </div>
            <div className="space-y-4">
              {backendBaseUrl ? (
                <button onClick={() => void handleCreateSnapshot()} className="btn-secondary">
                  Create snapshot
                </button>
              ) : null}
              {snapshotMessage && <p className="text-sm text-emerald-300">{snapshotMessage}</p>}
              {snapshots.length === 0 ? (
                <p className="text-sm text-slate-500">No persisted operator snapshots yet.</p>
              ) : (
                <div className="space-y-2">
                  {snapshots.map((snapshot) => (
                    <div key={snapshot.id} className="activity-row">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-white">
                            {snapshot.label ?? "Operator snapshot"}
                          </p>
                          <p className="text-sm text-slate-500">
                            {new Date(snapshot.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <span
                          className={
                            snapshot.summary.paused === null
                              ? "badge-muted"
                              : snapshot.summary.paused
                                ? "badge-red"
                                : "badge-green"
                          }
                        >
                          {snapshot.summary.paused === null
                            ? "Pause state unknown"
                            : snapshot.summary.paused
                              ? "Paused"
                              : "Active"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {snapshotDiff && (
                <pre className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/90 p-3 text-xs text-slate-300">
                  {JSON.stringify(snapshotDiff.changes, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="panel lg:col-span-2">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Identity And Runtime</p>
              <h3 className="panel-title">Configuration snapshot</h3>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <p className="text-sm text-slate-400">Token name</p>
              <p className="text-xl font-semibold text-white">{config.name}</p>
              <p className="text-sm text-slate-400">Symbol</p>
              <p className="text-lg font-medium text-white">{config.symbol}</p>
              <p className="text-sm text-slate-400">Decimals</p>
              <p className="text-lg font-medium text-white">{config.decimals}</p>
              <p className="text-sm text-slate-400">URI</p>
              <p className="truncate text-sm text-slate-300" title={config.uri}>
                {config.uri || "None"}
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Permanent delegate</span>
                <span className={config.enablePermanentDelegate ? "badge-green" : "badge-muted"}>
                  {config.enablePermanentDelegate ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Transfer hook</span>
                <span className={config.enableTransferHook ? "badge-green" : "badge-muted"}>
                  {config.enableTransferHook ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Default frozen</span>
                <span className={config.defaultAccountFrozen ? "badge-yellow" : "badge-muted"}>
                  {config.defaultAccountFrozen ? "Yes" : "No"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Total minted</span>
                <span className="text-sm font-medium text-white">
                  {formatTokenAmount(config.totalMinted.toString(), config.decimals)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Total burned</span>
                <span className="text-sm font-medium text-white">
                  {formatTokenAmount(config.totalBurned.toString(), config.decimals)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Addresses</p>
              <h3 className="panel-title">High-value accounts</h3>
            </div>
          </div>
          <div>
            {mintAddress && <AddressRow label="Mint" value={mintAddress.toBase58()} />}
            {configAddress && <AddressRow label="Config PDA" value={configAddress.toBase58()} />}
            <AddressRow label="Master authority" value={config.masterAuthority.toBase58()} />
          </div>
        </div>
      </section>
    </div>
  );
}
