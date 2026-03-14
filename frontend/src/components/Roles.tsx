"use client";

import { FC, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { ROLE_LABELS, truncateAddress } from "@/lib/constants";

interface RoleAccountData {
  config: PublicKey;
  user: PublicKey;
  roleType: number;
  active: boolean;
}

interface MinterQuotaData {
  config: PublicKey;
  minter: PublicKey;
  quota: BN;
  minted: BN;
}

interface RolesProps {
  config: {
    enableTransferHook: boolean;
    enablePermanentDelegate: boolean;
  } | null;
  onUpdateRole: (
    roleType: number,
    user: string,
    active: boolean,
  ) => Promise<string>;
  onUpdateMinterQuota: (minter: string, quota: string) => Promise<string>;
  fetchRoles: () => Promise<RoleAccountData[]>;
  fetchMinterQuotas: () => Promise<MinterQuotaData[]>;
}

function getRoleOptions(
  config: RolesProps["config"],
): { value: number; label: string }[] {
  const base = [
    { value: 0, label: "Minter" },
    { value: 1, label: "Burner" },
    { value: 2, label: "Pauser" },
  ];

  if (config?.enableTransferHook) {
    base.push({ value: 3, label: "Blacklister" });
  }

  if (config?.enablePermanentDelegate) {
    base.push({ value: 4, label: "Seizer" });
  }

  return base;
}

function usageColor(pct: number): string {
  if (pct > 80) return "bg-rose-500";
  if (pct >= 50) return "bg-amber-500";
  return "bg-emerald-500";
}

const Roles: FC<RolesProps> = ({
  config,
  onUpdateRole,
  onUpdateMinterQuota,
  fetchRoles,
  fetchMinterQuotas,
}) => {
  const [roles, setRoles] = useState<RoleAccountData[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  const [selectedRole, setSelectedRole] = useState<number>(0);
  const [roleUserAddress, setRoleUserAddress] = useState("");
  const [roleResult, setRoleResult] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  const [quotas, setQuotas] = useState<MinterQuotaData[]>([]);
  const [quotasLoading, setQuotasLoading] = useState(false);

  const [quotaMinterAddress, setQuotaMinterAddress] = useState("");
  const [quotaAmount, setQuotaAmount] = useState("");
  const [quotaResult, setQuotaResult] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaSubmitting, setQuotaSubmitting] = useState(false);

  const loadRoles = async () => {
    setRolesLoading(true);
    try {
      const data = await fetchRoles();
      setRoles(data);
    } catch (e) {
      console.error("Failed to fetch roles:", e);
    } finally {
      setRolesLoading(false);
    }
  };

  const loadQuotas = async () => {
    setQuotasLoading(true);
    try {
      const data = await fetchMinterQuotas();
      setQuotas(data);
    } catch (e) {
      console.error("Failed to fetch minter quotas:", e);
    } finally {
      setQuotasLoading(false);
    }
  };

  useEffect(() => {
    loadRoles();
    loadQuotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAssignRole = async () => {
    setRoleResult(null);
    setRoleError(null);
    setRoleSubmitting(true);
    try {
      const sig = await onUpdateRole(selectedRole, roleUserAddress, true);
      setRoleResult(`Role assigned. Tx: ${sig}`);
      await loadRoles();
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : String(e));
    } finally {
      setRoleSubmitting(false);
    }
  };

  const handleRevokeRole = async () => {
    setRoleResult(null);
    setRoleError(null);
    setRoleSubmitting(true);
    try {
      const sig = await onUpdateRole(selectedRole, roleUserAddress, false);
      setRoleResult(`Role revoked. Tx: ${sig}`);
      await loadRoles();
    } catch (e) {
      setRoleError(e instanceof Error ? e.message : String(e));
    } finally {
      setRoleSubmitting(false);
    }
  };

  const handleSetQuota = async () => {
    setQuotaResult(null);
    setQuotaError(null);
    setQuotaSubmitting(true);
    try {
      const sig = await onUpdateMinterQuota(quotaMinterAddress, quotaAmount);
      setQuotaResult(`Quota updated. Tx: ${sig}`);
      await loadQuotas();
    } catch (e) {
      setQuotaError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuotaSubmitting(false);
    }
  };

  const roleOptions = getRoleOptions(config);

  return (
    <div className="space-y-6">
      {/* Current Roles */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Access Control</p>
            <h2 className="panel-title">Current Roles</h2>
          </div>
          <button
            className="btn-secondary"
            onClick={loadRoles}
            disabled={rolesLoading}
          >
            {rolesLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {roles.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm text-slate-400">No roles assigned</p>
          </div>
        ) : (
          <div className="space-y-3">
            {roles.map((role, idx) => (
              <div key={idx} className="activity-row">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-300">
                      {truncateAddress(role.user.toBase58())}
                    </span>
                    <span className="badge-muted">
                      {ROLE_LABELS[role.roleType] ?? `Unknown(${role.roleType})`}
                    </span>
                  </div>
                  {role.active ? (
                    <span className="badge-green">Active</span>
                  ) : (
                    <span className="badge-red">Inactive</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Assign / Revoke Role */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Role Management</p>
            <h2 className="panel-title">Assign / Revoke Role</h2>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Role Type
            </label>
            <select
              className="input-field"
              value={selectedRole}
              onChange={(e) => setSelectedRole(Number(e.target.value))}
            >
              {roleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} ({opt.value})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              User Address
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Enter wallet address..."
              value={roleUserAddress}
              onChange={(e) => setRoleUserAddress(e.target.value)}
            />
          </div>

          <div className="flex gap-3">
            <button
              className="btn-primary"
              onClick={handleAssignRole}
              disabled={roleSubmitting || !roleUserAddress}
            >
              {roleSubmitting ? "Processing..." : "Assign Role"}
            </button>
            <button
              className="btn-danger"
              onClick={handleRevokeRole}
              disabled={roleSubmitting || !roleUserAddress}
            >
              {roleSubmitting ? "Processing..." : "Revoke Role"}
            </button>
          </div>

          {roleResult && (
            <div className="alert-panel alert-success">
              <p className="break-all text-sm text-emerald-200">{roleResult}</p>
            </div>
          )}
          {roleError && (
            <div className="alert-panel alert-critical">
              <p className="break-all text-sm text-rose-200">{roleError}</p>
            </div>
          )}
        </div>
      </div>

      {/* Minter Quotas */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Supply Limits</p>
            <h2 className="panel-title">Minter Quotas</h2>
          </div>
          <button
            className="btn-secondary"
            onClick={loadQuotas}
            disabled={quotasLoading}
          >
            {quotasLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        {quotas.length === 0 ? (
          <div className="empty-state">
            <p className="text-sm text-slate-400">No minter quotas configured</p>
          </div>
        ) : (
          <div className="space-y-3">
            {quotas.map((q, idx) => {
              const minted = q.minted.toNumber();
              const quota = q.quota.toNumber();
              const remaining = Math.max(0, quota - minted);
              const pct = quota > 0 ? (minted / quota) * 100 : 0;

              return (
                <div key={idx} className="activity-row">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-mono text-xs text-slate-300">
                      {truncateAddress(q.minter.toBase58())}
                    </span>
                    <span className="text-xs text-slate-500">
                      {minted.toLocaleString()} / {quota.toLocaleString()} (remaining: {remaining.toLocaleString()})
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                      <div
                        className={`h-full rounded-full ${usageColor(pct)}`}
                        style={{ width: `${Math.min(pct, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400">
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Set Minter Quota */}
      <div className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Quota Configuration</p>
            <h2 className="panel-title">Set Minter Quota</h2>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Minter Address
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Enter minter wallet address..."
              value={quotaMinterAddress}
              onChange={(e) => setQuotaMinterAddress(e.target.value)}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              Quota Amount
            </label>
            <input
              type="text"
              className="input-field"
              placeholder="Enter quota amount..."
              value={quotaAmount}
              onChange={(e) => setQuotaAmount(e.target.value)}
            />
          </div>

          <button
            className="btn-primary"
            onClick={handleSetQuota}
            disabled={quotaSubmitting || !quotaMinterAddress || !quotaAmount}
          >
            {quotaSubmitting ? "Processing..." : "Set Quota"}
          </button>

          {quotaResult && (
            <div className="alert-panel alert-success">
              <p className="break-all text-sm text-emerald-200">{quotaResult}</p>
            </div>
          )}
          {quotaError && (
            <div className="alert-panel alert-critical">
              <p className="break-all text-sm text-rose-200">{quotaError}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Roles;
