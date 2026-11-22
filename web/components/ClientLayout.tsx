"use client";
import dynamic from "next/dynamic";
import { useState, useEffect } from "react";
import { walletProvider } from "@/lib/provider";

const DApp       = dynamic(() => import("./DApp"),         { ssr: false });
const WalletWidget = dynamic(() => import("./WalletWidget"), { ssr: false });

export default function ClientLayout() {
  const [walletOpen, setWalletOpen] = useState(false);
  const [hasPending, setHasPending] = useState(false);

  // Auto-open wallet panel on mobile when approval is needed
  useEffect(() => {
    const unsub = walletProvider.addPendingListener(req => {
      setHasPending(!!req);
      if (req) setWalletOpen(true);
    });
    return unsub;
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top nav */}
      <header className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
            <span className="font-semibold text-slate-900 text-sm">OpenSigner</span>
            <span className="hidden sm:inline text-slate-300 text-sm">·</span>
            <span className="hidden sm:inline text-slate-500 text-xs">Embedded Wallet Demo</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse-dot" />
              Sepolia testnet
            </span>
            {/* Mobile wallet toggle */}
            <button
              onClick={() => setWalletOpen(o => !o)}
              className="md:hidden relative flex items-center gap-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-full"
            >
              {hasPending && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-red-500 rounded-full" />
              )}
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
              </svg>
              Wallet
            </button>
          </div>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* dApp — main area */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-8">
          <div className="max-w-xl mx-auto">
            <div className="mb-8">
              <h1 className="text-2xl font-bold text-slate-900">Sepolia dApp</h1>
              <p className="text-slate-500 mt-1 text-sm">
                Send and receive ETH using your embedded wallet.
              </p>
            </div>
            <DApp />
          </div>
        </main>

        {/* One wallet instance owns approvals on both desktop and mobile. */}
        {walletOpen && (
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => !hasPending && setWalletOpen(false)}
          />
        )}
        <aside
          className={walletOpen
            ? "fixed bottom-0 left-0 right-0 z-50 bg-slate-50 rounded-t-2xl px-4 pb-6 pt-3 max-h-[80vh] overflow-y-auto flex flex-col items-center md:static md:z-auto md:max-h-none md:rounded-none md:shrink-0 md:p-4 md:items-start md:pt-8 md:border-l md:border-slate-100"
            : "hidden md:flex md:shrink-0 md:p-4 md:items-start md:pt-8 md:border-l md:border-slate-100"}
        >
          <div className="md:hidden w-8 h-1 bg-slate-300 rounded-full mx-auto mb-3 shrink-0" />
          <WalletWidget />
        </aside>
      </div>
    </div>
  );
}
