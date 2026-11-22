"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import confetti from "canvas-confetti";
import {
  walletProvider,
  announceEIP6963Provider,
  PROVIDER_INFO,
  type EIP6963ProviderInfo,
} from "@/lib/provider";
import { getSepoliaBalance } from "@/lib/chain";
import { setupSmartAccount, type SmartAccountSetup } from "@/lib/erc4337";
import { getAddress, parseEther, isAddress } from "viem";

interface DiscoveredWallet {
  info: EIP6963ProviderInfo;
  provider: typeof walletProvider;
}

type DAppState = "discover" | "connecting" | "connected";
type SendStep  = "idle" | "building" | "approving" | "broadcasting" | "confirmed" | "pending" | "error";

interface TxResult {
  txHash?: string;
  userOpHash?: string;
  pending?: boolean;
  error?: string;
}

const SEND_STEPS: { key: SendStep; label: string }[] = [
  { key: "building",     label: "Building transaction" },
  { key: "approving",    label: "Approve in wallet"    },
  { key: "broadcasting", label: "Broadcasting"         },
  { key: "confirmed",    label: "Confirmed"            },
];

function StepIndicator({ step }: { step: SendStep }) {
  const active = ["building", "approving", "broadcasting", "confirmed"];
  const idx    = active.indexOf(step);
  if (idx === -1) return null;

  return (
    <div className="flex items-center gap-1 w-full mb-4">
      {SEND_STEPS.map((s, i) => {
        const done    = i < idx;
        const current = i === idx;
        return (
          <div key={s.key} className="flex items-center gap-1 flex-1 min-w-0">
            <div className="flex flex-col items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all duration-300
                ${done    ? "bg-indigo-600 text-white"
                : current ? "bg-indigo-600 text-white ring-4 ring-indigo-100"
                : "bg-slate-200 text-slate-400"}`}>
                {done ? (
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  current && step !== "confirmed" ? (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : i + 1
                )}
              </div>
              <span className={`text-xs whitespace-nowrap ${current ? "text-indigo-600 font-medium" : done ? "text-slate-500" : "text-slate-400"}`}>
                {s.label}
              </span>
            </div>
            {i < SEND_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mb-5 transition-all duration-500 ${done ? "bg-indigo-600" : "bg-slate-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function DApp() {
  const [wallets,    setWallets]    = useState<DiscoveredWallet[]>([]);
  const [dappState,  setDappState]  = useState<DAppState>("discover");
  const [ownerAddr,  setOwnerAddr]  = useState("");
  const [activeProvider, setActiveProvider] = useState(walletProvider);
  const [saSetup,    setSaSetup]    = useState<SmartAccountSetup | null>(null);
  const [saLoading,  setSaLoading]  = useState(false);
  const [saError,    setSaError]    = useState<string | null>(null);
  const [balance,    setBalance]    = useState("");
  const [balLoading, setBalLoading] = useState(false);
  const [tab,        setTab]        = useState<"send" | "receive">("send");
  const [sendTo,     setSendTo]     = useState("");
  const [sendAmt,    setSendAmt]    = useState("");
  const [sendStep,   setSendStep]   = useState<SendStep>("idle");
  const [txResult,   setTxResult]   = useState<TxResult | null>(null);
  const [copied,           setCopied]          = useState(false);
  const [showOtherWallets, setShowOtherWallets] = useState(false);
  const isSending = sendStep !== "idle" && sendStep !== "confirmed" && sendStep !== "pending" && sendStep !== "error";

  // Discover EIP-6963 wallets
  useEffect(() => {
    const handleAnnounce = (e: Event) => {
      const { info, provider } = (e as CustomEvent).detail as DiscoveredWallet;
      setWallets(prev => prev.some(w => w.info.uuid === info.uuid) ? prev : [...prev, { info, provider }]);
    };
    window.addEventListener("eip6963:announceProvider", handleAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", handleAnnounce);
  }, []);

  useEffect(() => {
    const cleanup = announceEIP6963Provider();
    return cleanup;
  }, []);

  const refreshBalance = useCallback(async (addr: string) => {
    if (!addr) return;
    setBalLoading(true);
    const bal = await getSepoliaBalance(addr).catch(() => "0.000000");
    setBalance(bal);
    setBalLoading(false);
  }, []);

  // Subscribe before reading accounts so readiness events cannot be missed.
  useEffect(() => {
    let disposed = false;
    let accountChanged = false;
    const syncAccounts = (accounts: unknown) => {
      if (disposed) return;
      const owner = Array.isArray(accounts) ? accounts[0] ?? "" : "";
      setOwnerAddr(owner);
      setDappState(owner ? "connected" : "discover");
      setSaSetup(null);
      setBalance("");
      setTxResult(null);
      setSendStep("idle");
    };
    const onAccountsChanged = (accounts: unknown) => {
      accountChanged = true;
      syncAccounts(accounts);
    };
    activeProvider.on("accountsChanged", onAccountsChanged);
    void activeProvider.request({ method: "eth_accounts" }).then(accounts => {
      if (!accountChanged) syncAccounts(accounts);
    }).catch(() => {});
    return () => {
      disposed = true;
      activeProvider.removeListener("accountsChanged", onAccountsChanged);
    };
  }, [activeProvider]);

  // Account setup also runs for restored sessions and account changes.
  useEffect(() => {
    let disposed = false;
    setSaSetup(null);
    setSaError(null);
    setSaLoading(!!ownerAddr);
    if (!ownerAddr) return;
    void (async () => {
      try {
        const setup = await setupSmartAccount(getAddress(ownerAddr));
        if (disposed) return;
        setSaSetup(setup);
        setBalLoading(true);
        const bal = await getSepoliaBalance(setup.saAddress).catch(() => "0.000000");
        if (!disposed) {
          setBalance(bal);
          setBalLoading(false);
        }
      } catch (err) {
        if (!disposed) setSaError((err as Error).message);
      } finally {
        if (!disposed) setSaLoading(false);
      }
    })();
    return () => { disposed = true; };
  }, [ownerAddr]);

  async function connect(wallet: DiscoveredWallet) {
    setDappState("connecting");
    try {
      const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
      const owner = accounts[0] ?? "";
      setActiveProvider(wallet.provider);
      setOwnerAddr(owner);
      setDappState(owner ? "connected" : "discover");
    } catch {
      setDappState("discover");
    }
  }

  function disconnect() {
    walletProvider.setAccount(null);
    setOwnerAddr("");
    setSaSetup(null);
    setBalance("");
    setDappState("discover");
    setTxResult(null);
    setSendStep("idle");
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(sendTo) || !sendAmt || !saSetup || isSending) return;
    setTxResult(null);
    setSendStep("building");

    // Track when wallet approval popup appears
    const unsubPending = walletProvider.addPendingListener(req => {
      if (req?.method === "personal_sign") setSendStep("approving");
      else if (!req) setSendStep(prev => prev === "approving" ? "broadcasting" : prev);
    });

    try {
      setSendStep("building");
      const result = await saSetup.send(getAddress(sendTo), parseEther(sendAmt));
      setSendStep("confirmed");
      setTxResult({ txHash: result.txHash, userOpHash: result.userOpHash });
      void refreshBalance(saSetup.saAddress);

      // 🎉 Confetti
      void confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 }, colors: ["#4F46E5", "#7C3AED", "#059669", "#F59E0B"] });
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string; userOpHash?: string };
      if (e.code === 4001) {
        setSendStep("idle");
      } else if (e.userOpHash) {
        setSendStep("pending");
        setTxResult({ pending: true, userOpHash: e.userOpHash });
      } else {
        setSendStep("error");
        setTxResult({ error: e.message ?? "Unknown error" });
      }
    } finally {
      unsubPending();
    }
  }

  const saAddress = saSetup?.saAddress ?? "";

  // ── Discover ────────────────────────────────────────────────────────────────
  if (dappState !== "connected") {
    // Always show OpenSigner first; fall back to whatever announces first
    const primary = wallets.find(w => w.info.rdns === PROVIDER_INFO.rdns) ?? wallets[0];
    const others  = wallets.filter(w => w !== primary);

    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] gap-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200">
          <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
          </svg>
        </div>

        <div>
          <h2 className="text-xl font-bold text-slate-900">Connect your wallet</h2>
          <p className="text-slate-500 mt-1 text-sm max-w-xs mx-auto">
            {wallets.length === 0
              ? "Sign in via the wallet panel to get started"
              : "Ready to connect"}
          </p>
        </div>

        <div className="flex flex-col gap-2 w-full max-w-xs">
          {/* Primary — OpenSigner */}
          {primary && (
            <button
              onClick={() => connect(primary)}
              disabled={dappState === "connecting"}
              className="flex items-center gap-3 px-5 py-3 bg-white border-2 border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 rounded-2xl transition-all shadow-sm disabled:opacity-50"
            >
              <img src={primary.info.icon} alt="" className="w-8 h-8 rounded-xl" />
              <div className="text-left flex-1">
                <p className="font-semibold text-sm text-slate-900">{primary.info.name}</p>
                <p className="text-xs text-slate-400">{primary.info.rdns}</p>
              </div>
              {dappState === "connecting" ? (
                <svg className="w-4 h-4 animate-spin text-indigo-500 shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          )}

          {/* Other wallets — collapsible */}
          {others.length > 0 && (
            <div className="w-full">
              <button
                onClick={() => setShowOtherWallets(v => !v)}
                className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showOtherWallets ? "Hide" : `${others.length} other wallet${others.length > 1 ? "s" : ""}`}
                <svg
                  className={`w-3 h-3 transition-transform ${showOtherWallets ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showOtherWallets && (
                <div className="flex flex-col gap-1.5 mt-1">
                  {others.map(w => (
                    <button key={w.info.uuid} onClick={() => connect(w)}
                      className="flex items-center gap-2.5 px-4 py-2.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl text-sm transition-all">
                      <img src={w.info.icon} alt="" className="w-5 h-5 rounded-md shrink-0" />
                      <span className="text-slate-700 text-left">{w.info.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Connected ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Account card */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {/* Gradient header — address left, balance right, all on same baseline */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <div className="w-6 h-6 rounded-lg bg-white/60" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium text-indigo-200">Smart Account</span>
                <span className="text-xs bg-white/20 text-white px-1.5 py-0.5 rounded-full font-medium">Sepolia</span>
              </div>
              {saLoading ? (
                <div className="h-4 w-32 bg-white/20 animate-pulse rounded mt-1" />
              ) : saAddress ? (
                <p className="font-mono text-sm font-semibold text-white truncate">
                  {saAddress.slice(0, 10)}…{saAddress.slice(-6)}
                </p>
              ) : (
                <p className="text-xs text-red-200 mt-0.5 truncate" title={saError ?? ""}>{saError ?? "Setup failed"}</p>
              )}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="flex items-center gap-1 justify-end">
              <span className="text-2xl font-bold text-white font-mono leading-none">
                {saAddress ? (balance || "0.000000") : "—"}
              </span>
              <span className="text-xs text-indigo-200 self-end pb-0.5">ETH</span>
              {saAddress && (
                <button onClick={() => refreshBalance(saAddress)} disabled={balLoading}
                  className={`text-indigo-200 hover:text-white transition-colors ml-0.5 ${balLoading ? "animate-spin" : ""}`}>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </div>
            {saAddress && (
              <a href="https://www.alchemy.com/faucets/ethereum-sepolia" target="_blank" rel="noopener noreferrer"
                className="text-xs text-indigo-200 hover:text-white">
                Get test ETH ↗
              </a>
            )}
          </div>
        </div>
        {/* Footer — owner key */}
        <div className="px-4 py-2.5 border-t border-slate-50">
          <p className="text-xs text-slate-400">
            Owner: <span className="font-mono">{ownerAddr.slice(0, 10)}…{ownerAddr.slice(-4)}</span>
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl">
        {(["send", "receive"] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setTxResult(null); setSendStep("idle"); }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all capitalize
              ${tab === t ? "bg-white shadow-sm text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            {t}
          </button>
        ))}
      </div>

      {/* Send tab */}
      {tab === "send" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 space-y-4">
          {sendStep !== "idle" && sendStep !== "error" && (
            <StepIndicator step={sendStep} />
          )}

          <form onSubmit={handleSend} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Recipient</label>
              <input
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-mono placeholder:font-sans focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition-all"
                placeholder="0x..."
                value={sendTo}
                onChange={e => { setSendTo(e.target.value); setTxResult(null); setSendStep("idle"); }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Amount</label>
              <div className="relative">
                <input
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 pr-14 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 transition-all"
                  placeholder="0.001"
                  type="number" step="any" min="0"
                  value={sendAmt}
                  onChange={e => { setSendAmt(e.target.value); setTxResult(null); setSendStep("idle"); }}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">ETH</span>
              </div>
            </div>
            <button
              type="submit"
              disabled={isSending || !isAddress(sendTo) || !sendAmt || !saSetup}
              className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-all shadow-sm shadow-indigo-200"
            >
              {isSending
                ? sendStep === "building"     ? "Building transaction…"
                : sendStep === "approving"    ? "Waiting for approval…"
                : sendStep === "broadcasting" ? "Broadcasting…"
                : "Sending…"
                : !saSetup ? "Setting up account…"
                : "Send ETH"}
            </button>
          </form>

          {/* Result */}
          {txResult && (
            <div className={`rounded-xl p-4 space-y-2 animate-fade-in ${
              txResult.error ? "bg-red-50 border border-red-100"
              : txResult.pending ? "bg-amber-50 border border-amber-100"
              : "bg-emerald-50 border border-emerald-100"}`}>
              {txResult.error ? (
                <p className="text-sm text-red-700">✗ {txResult.error}</p>
              ) : txResult.pending ? (
                <>
                  <p className="text-sm font-semibold text-amber-800">⏳ Transaction submitted</p>
                  <p className="text-xs text-amber-700">Waiting for confirmation on-chain.</p>
                  {txResult.userOpHash && (
                    <a href={`https://jiffyscan.xyz/userOpHash/${txResult.userOpHash}?network=sepolia`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 underline">
                      Track on JiffyScan ↗
                    </a>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <svg className="w-5 h-5 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} strokeDasharray="48" strokeDashoffset="0" className="animate-check" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-emerald-800">Transaction confirmed</p>
                  </div>
                  {txResult.txHash && (
                    <>
                      <p className="font-mono text-xs text-slate-500 bg-white rounded-lg p-2 border border-emerald-100 truncate">
                        {txResult.txHash}
                      </p>
                      <a href={`https://sepolia.etherscan.io/tx/${txResult.txHash}`}
                        target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800 bg-white px-3 py-1.5 rounded-lg border border-indigo-100">
                        View on Sepolia Etherscan ↗
                      </a>
                    </>
                  )}
                  {txResult.userOpHash && (
                    <a href={`https://jiffyscan.xyz/userOpHash/${txResult.userOpHash}?network=sepolia`}
                      target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 underline">
                      UserOp on JiffyScan ↗
                    </a>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Receive tab */}
      {tab === "receive" && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5 text-center space-y-4">
          {saAddress ? (
            <>
              <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center mx-auto">
                <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 mb-2">Your Smart Account address</p>
                <div className="p-3 bg-slate-50 rounded-xl font-mono text-xs break-all text-slate-700 border border-slate-100">
                  {saAddress}
                </div>
              </div>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => { void navigator.clipboard.writeText(saAddress); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors">
                  {copied ? "✓ Copied!" : "Copy address"}
                </button>
                <a href={`https://sepolia.etherscan.io/address/${saAddress}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition-colors">
                  Etherscan ↗
                </a>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-400 py-4">Setting up smart account…</p>
          )}
        </div>
      )}

      <button onClick={disconnect} className="w-full text-xs text-slate-400 hover:text-slate-600 py-2 transition-colors">
        Disconnect
      </button>
    </div>
  );
}
