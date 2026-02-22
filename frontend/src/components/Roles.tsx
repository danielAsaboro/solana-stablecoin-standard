"use client";

import { FC, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { ROLE_LABELS, truncateAddress } from "@/lib/constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Available role options based on current config feature flags. */
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

/** Return a Tailwind color class for a usage percentage bar. */
function usageColor(pct: number): string {
  if (pct > 80) return "bg-red-500";
  if (pct >= 50) return "bg-yellow-500";
  return "bg-green-500";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const Roles: FC<RolesProps> = ({
  config,
  onUpdateRole,
  onUpdateMinterQuota,
  fetchRoles,
  fetchMinterQuotas,
}) => {
  // ---- Roles state ----
  const [roles, setRoles] = useState<RoleAccountData[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  // ---- Assign / Revoke form ----
  const [selectedRole, setSelectedRole] = useState<number>(0);
  const [roleUserAddress, setRoleUserAddress] = useState("");
  const [roleResult, setRoleResult] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [roleSubmitting, setRoleSubmitting] = useState(false);

  // ---- Minter quotas state ----
  const [quotas, setQuotas] = useState<MinterQuotaData[]>([]);
  const [quotasLoading, setQuotasLoading] = useState(false);

  // ---- Set Quota form ----
  const [quotaMinterAddress, setQuotaMinterAddress] = useState("");
  const [quotaAmount, setQuotaAmount] = useState("");
  const [quotaResult, setQuotaResult] = useState<string | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [quotaSubmitting, setQuotaSubmitting] = useState(false);

  // ---- Data loading helpers ----

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

  // Auto-load on mount
  useEffect(() => {
    loadRoles();
    loadQuotas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Handlers ----

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

  // ---- Derived data ----

  const roleOptions = getRoleOptions(config);

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------------------------ */}
      {/* Current Roles                                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Current Roles</h2>
          <button
            className="btn-primary text-sm"
            onClick={loadRoles}
            disabled={rolesLoading}
          >
            {rolesLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="p-4">
          {roles.length === 0 ? (
            <p className="text-sm text-gray-400">No roles assigned</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400">
                    <th className="pb-2 pr-4">Address</th>
                    <th className="pb-2 pr-4">Role</th>
                    <th className="pb-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role, idx) => (
                    <tr
                      key={idx}
                      className="border-b border-gray-800 text-gray-200"
                    >
                      <td className="py-2 pr-4 font-mono text-xs">
                        {truncateAddress(role.user.toBase58())}
                      </td>
                      <td className="py-2 pr-4">
                        {ROLE_LABELS[role.roleType] ?? `Unknown(${role.roleType})`}
                      </td>
                      <td className="py-2">
                        {role.active ? (
                          <span className="badge-green">Active</span>
                        ) : (
                          <span className="badge-red">Inactive</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Assign / Revoke Role                                                */}
      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-white">
            Assign / Revoke Role
          </h2>
        </div>

        <div className="space-y-4 p-4">
          {/* Role type dropdown */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
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

          {/* User address input */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
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

          {/* Action buttons */}
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

          {/* Result / Error messages */}
          {roleResult && (
            <p className="break-all text-sm text-green-400">{roleResult}</p>
          )}
          {roleError && (
            <p className="break-all text-sm text-red-400">{roleError}</p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Minter Quotas                                                       */}
      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Minter Quotas</h2>
          <button
            className="btn-primary text-sm"
            onClick={loadQuotas}
            disabled={quotasLoading}
          >
            {quotasLoading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="p-4">
          {quotas.length === 0 ? (
            <p className="text-sm text-gray-400">No minter quotas configured</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-700 text-gray-400">
                    <th className="pb-2 pr-4">Minter</th>
                    <th className="pb-2 pr-4">Minted</th>
                    <th className="pb-2 pr-4">Quota</th>
                    <th className="pb-2 pr-4">Remaining</th>
                    <th className="pb-2">Usage %</th>
                  </tr>
                </thead>
                <tbody>
                  {quotas.map((q, idx) => {
                    const minted = q.minted.toNumber();
                    const quota = q.quota.toNumber();
                    const remaining = Math.max(0, quota - minted);
                    const pct = quota > 0 ? (minted / quota) * 100 : 0;

                    return (
                      <tr
                        key={idx}
                        className="border-b border-gray-800 text-gray-200"
                      >
                        <td className="py-2 pr-4 font-mono text-xs">
                          {truncateAddress(q.minter.toBase58())}
                        </td>
                        <td className="py-2 pr-4">
                          {minted.toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">
                          {quota.toLocaleString()}
                        </td>
                        <td className="py-2 pr-4">
                          {remaining.toLocaleString()}
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-700">
                              <div
                                className={`h-full rounded-full ${usageColor(pct)}`}
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400">
                              {pct.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Set Minter Quota                                                    */}
      {/* ------------------------------------------------------------------ */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold text-white">Set Minter Quota</h2>
        </div>

        <div className="space-y-4 p-4">
          {/* Minter address input */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
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

          {/* Quota amount input */}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-300">
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

          {/* Action button */}
          <button
            className="btn-primary"
            onClick={handleSetQuota}
            disabled={quotaSubmitting || !quotaMinterAddress || !quotaAmount}
          >
            {quotaSubmitting ? "Processing..." : "Set Quota"}
          </button>

          {/* Result / Error messages */}
          {quotaResult && (
            <p className="break-all text-sm text-green-400">{quotaResult}</p>
          )}
          {quotaError && (
            <p className="break-all text-sm text-red-400">{quotaError}</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default Roles;
