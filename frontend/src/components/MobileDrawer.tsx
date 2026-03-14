"use client";

import { FC, useEffect } from "react";
import { navGroups } from "@/components/Sidebar";
import { usePrivyLogin, useSolanaWallet } from "@/hooks/usePrivySolana";
import { truncateAddress } from "@/lib/constants";

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  activeView: string;
  onViewChange: (view: string) => void;
}

const MobileDrawer: FC<MobileDrawerProps> = ({
  open,
  onClose,
  activeView,
  onViewChange,
}) => {
  const { login, logout, authenticated } = usePrivyLogin();
  const { publicKey } = useSolanaWallet();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="drawer-backdrop" onClick={onClose} />

      {/* Panel */}
      <div className="drawer-panel">
        <div className="flex h-full flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-xs font-semibold text-white">
                SSS
              </div>
              <span className="text-sm font-semibold text-white">Stablecoin Console</span>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 overflow-y-auto px-4 py-3">
            {navGroups.map((group) => (
              <div key={group.label}>
                <p className="nav-section-label">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map((item) => (
                    <button
                      key={item.key}
                      onClick={() => {
                        onViewChange(item.key);
                        onClose();
                      }}
                      className={
                        activeView === item.key
                          ? "sidebar-link-active w-full"
                          : "sidebar-link w-full"
                      }
                    >
                      {item.icon}
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          {/* Wallet footer */}
          <div className="border-t border-slate-800 p-4">
            {authenticated ? (
              <div className="space-y-2">
                {publicKey && (
                  <p className="text-center font-mono text-xs text-slate-400">
                    {truncateAddress(publicKey.toBase58())}
                  </p>
                )}
                <button onClick={logout} className="btn-secondary w-full">
                  Disconnect
                </button>
              </div>
            ) : (
              <button onClick={login} className="btn-primary w-full">
                Sign In
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
};

export default MobileDrawer;
