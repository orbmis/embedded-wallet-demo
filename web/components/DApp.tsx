"use client";
import { useState, useEffect, useCallback } from "react";
import {
  walletProvider,
  announceEIP6963Provider,
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

interface TxResult {
  ok: boolean;
  txHash?: string;
  error?: string;
}

export default function DApp() {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [dappState, setDappState] = useState<DAppState>("discover");
  const [ownerAddress, setOwnerAddress] = useState("");
  const [saSetup, setSaSetup] = useState<SmartAccountSetup | null>(null);
  const [saLoading, setSaLoading] = useState(false);
  const [saError, setSaError] = useState<string | null>(null);
  const [balance, setBalance] = useState("");
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [tab, setTab] = useState<"send" | "receive">("send");

  // Send form
  const [sendTo, setSendTo] = useState("");
  const [sendAmount, setSendAmount] = useState("");
  const [sending, setSending] = useState(false);
  const [txResult, setTxResult] = useState<TxResult | null>(null);

  // Discover EIP-6963 wallets
  useEffect(() => {
    const handleAnnounce = (e: Event) => {
      const { info, provider } = (e as CustomEvent).detail as DiscoveredWallet;
      setWallets(prev => {
        if (prev.some(w => w.info.uuid === info.uuid)) return prev;
        return [...prev, { info, provider }];
      });
    };
    window.addEventListener("eip6963:announceProvider", handleAnnounce);
    // Trigger announce from any wallets already listening
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => window.removeEventListener("eip6963:announceProvider", handleAnnounce);
  }, []);

  // Announce our wallet once the DApp mounts
  useEffect(() => {
    const cleanup = announceEIP6963Provider();
    return cleanup;
  }, []);

  // Keep balance fresh when connected
  const refreshBalance = useCallback(async (addr: string) => {
    if (!addr) return;
    setBalanceLoading(true);
    const bal = await getSepoliaBalance(addr).catch(() => "0.000000");
    setBalance(bal);
    setBalanceLoading(false);
  }, []);

  async function connect(wallet: DiscoveredWallet) {
    setDappState("connecting");
    try {
      const accounts = (await wallet.provider.request({
        method: "eth_requestAccounts",
      })) as string[];
      const owner = accounts[0] ?? "";
      setOwnerAddress(owner);
      setDappState("connected");

      // Compute ERC-4337 SimpleAccount address from owner key
      setSaLoading(true);
      setSaError(null);
      try {
        const setup = await setupSmartAccount(getAddress(owner));
        setSaSetup(setup);
        void refreshBalance(setup.saAddress);
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        setSaError(msg);
        console.error("SA setup:", msg);
      } finally {
        setSaLoading(false);
      }

      wallet.provider.on("accountsChanged", (accs: unknown) => {
        const newOwner = (accs as string[])[0] ?? "";
        if (!newOwner) { disconnect(); return; }
        setOwnerAddress(newOwner);
        setSaSetup(null);
      });
    } catch {
      setDappState("discover");
    }
  }

  function disconnect() {
    walletProvider.setAccount(null);
    setOwnerAddress("");
    setSaSetup(null);
    setBalance("");
    setDappState("discover");
    setTxResult(null);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(sendTo) || !sendAmount || !saSetup) return;
    setSending(true);
    setTxResult(null);
    try {
      const txHash = await saSetup.send(
        getAddress(sendTo),
        parseEther(sendAmount),
      );
      setTxResult({ ok: true, txHash });
      void refreshBalance(saSetup.saAddress);
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e.code === 4001) {
        setTxResult({ ok: false, error: "Rejected." });
      } else {
        setTxResult({ ok: false, error: e.message ?? "Unknown error" });
      }
    } finally {
      setSending(false);
    }
  }

  // ── Discover state ────────────────────────────────────────────────────────
  if (dappState === "discover" || dappState === "connecting") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">Connect your wallet</h2>
          <p className="text-gray-500 mt-2 text-sm">
            {wallets.length === 0
              ? "Waiting for wallet — sign in via the wallet panel →"
              : "Select a wallet to connect"}
          </p>
        </div>

        {wallets.length > 0 && (
          <div className="flex flex-col gap-3 w-full max-w-sm">
            {wallets.map(w => (
              <button
                key={w.info.uuid}
                onClick={() => connect(w)}
                disabled={dappState === "connecting"}
                className="flex items-center gap-3 w-full px-4 py-3 border-2 border-gray-200 rounded-xl hover:border-indigo-400 hover:bg-indigo-50 transition-all disabled:opacity-50"
              >
                <img src={w.info.icon} alt="" className="w-8 h-8 rounded-lg" />
                <div className="text-left">
                  <p className="font-medium text-sm">{w.info.name}</p>
                  <p className="text-xs text-gray-400">{w.info.rdns}</p>
                </div>
                {dappState === "connecting" && (
                  <svg className="ml-auto w-4 h-4 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const saAddress = saSetup?.saAddress ?? "";

  // ── Connected state ───────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto w-full">
      {/* Account bar */}
      <div className="p-4 bg-white rounded-2xl shadow-sm border border-gray-100 mb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 shrink-0" />
            <div>
              <p className="text-xs text-gray-400">Smart Account · Sepolia</p>
              {saLoading ? (
                <p className="text-xs text-gray-400">Computing address…</p>
              ) : saAddress ? (
                <p className="text-sm font-mono font-medium">
                  {saAddress.slice(0, 10)}…{saAddress.slice(-6)}
                </p>
              ) : saError ? (
                <p className="text-xs text-red-500 max-w-[180px] truncate" title={saError}>{saError}</p>
              ) : null}
            </div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1 justify-end">
              <p className="text-lg font-bold">
                {saAddress ? (balance || "—") : "—"}
                <span className="text-sm font-normal text-gray-500 ml-1">ETH</span>
              </p>
              {saAddress && (
                <button
                  onClick={() => refreshBalance(saAddress)}
                  disabled={balanceLoading}
                  className={`text-gray-400 hover:text-indigo-600 ${balanceLoading ? "animate-spin" : ""}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </button>
              )}
            </div>
            {saAddress && (
              <a
                href={`https://www.alchemy.com/faucets/ethereum-sepolia`}
                target="_blank" rel="noopener noreferrer"
                className="text-xs text-indigo-500 hover:underline"
              >
                Get test ETH ↗
              </a>
            )}
          </div>
        </div>
        <p className="text-xs text-gray-400">
          Owner key: <span className="font-mono">{ownerAddress.slice(0, 10)}…{ownerAddress.slice(-4)}</span>
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-xl mb-4">
        {(["send", "receive"] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setTxResult(null); }}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors capitalize
              ${tab === t ? "bg-white shadow-sm text-gray-900" : "text-gray-500 hover:text-gray-700"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Send tab */}
      {tab === "send" && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <form onSubmit={handleSend} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Recipient address</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-400"
                placeholder="0x..."
                value={sendTo}
                onChange={e => setSendTo(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Amount (ETH)</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                placeholder="0.001"
                type="number"
                step="any"
                min="0"
                value={sendAmount}
                onChange={e => setSendAmount(e.target.value)}
              />
            </div>
            <button
              type="submit"
              disabled={sending || !isAddress(sendTo) || !sendAmount || !saSetup}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {sending ? "Submitting…" : !saSetup ? "Setting up account…" : "Send"}
            </button>
          </form>

          {txResult && (
            <div className={`mt-4 p-3 rounded-xl text-sm ${txResult.ok ? "bg-green-50 border border-green-200" : "bg-red-50 border border-red-200"}`}>
              {txResult.ok ? (
                <div className="space-y-2">
                  <p className="font-medium text-green-800">✓ Transaction confirmed</p>
                  <div className="flex items-center gap-2 font-mono text-xs text-gray-600 bg-white rounded-lg p-2 border">
                    <span className="truncate">{txResult.txHash}</span>
                  </div>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${txResult.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    View on Sepolia Etherscan ↗
                  </a>
                </div>
              ) : (
                <p className="text-red-700">✗ {txResult.error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Receive tab */}
      {tab === "receive" && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center space-y-3">
          <p className="text-xs text-gray-500 font-medium">Your Smart Account address</p>
          {saAddress ? (
            <>
              <div className="p-3 bg-gray-50 rounded-lg font-mono text-xs break-all text-gray-800">
                {saAddress}
              </div>
              <button
                onClick={() => { void navigator.clipboard.writeText(saAddress); }}
                className="text-indigo-600 text-sm hover:underline"
              >
                Copy address
              </button>
              <div className="pt-1">
                <a
                  href={`https://sepolia.etherscan.io/address/${saAddress}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-gray-400 hover:text-indigo-600"
                >
                  View on Sepolia Etherscan ↗
                </a>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-400">Setting up smart account…</p>
          )}
        </div>
      )}

      <button
        onClick={disconnect}
        className="mt-4 w-full text-xs text-gray-400 hover:text-gray-600 py-2"
      >
        Disconnect
      </button>
    </div>
  );
}
