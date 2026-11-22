"use client";
import { useState, useEffect, useCallback } from "react";
import {
  walletProvider,
  announceEIP6963Provider,
  type EIP6963ProviderInfo,
} from "@/lib/provider";
import { getSepoliaBalance, verifySignature } from "@/lib/chain";
import { getAddress, parseEther, formatEther, isAddress, type Hex } from "viem";

interface DiscoveredWallet {
  info: EIP6963ProviderInfo;
  provider: typeof walletProvider;
}

type DAppState = "discover" | "connecting" | "connected";

interface TxResult {
  ok: boolean;
  signature?: string;
  error?: string;
}

export default function DApp() {
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [dappState, setDappState] = useState<DAppState>("discover");
  const [address, setAddress] = useState("");
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
      const addr = accounts[0] ?? "";
      setAddress(addr);
      setDappState("connected");
      void refreshBalance(addr);

      // Keep balance synced when accounts change
      wallet.provider.on("accountsChanged", (accs: unknown) => {
        const newAddr = (accs as string[])[0] ?? "";
        setAddress(newAddr);
        if (newAddr) void refreshBalance(newAddr);
        else setDappState("discover");
      });
    } catch {
      setDappState("discover");
    }
  }

  function disconnect() {
    walletProvider.setAccount(null);
    setAddress("");
    setBalance("");
    setDappState("discover");
    setTxResult(null);
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!isAddress(sendTo) || !sendAmount) return;
    setSending(true);
    setTxResult(null);
    try {
      const result = await walletProvider.request({
        method: "eth_sendTransaction",
        params: [{
          from: address,
          to: sendTo,
          value: "0x" + parseEther(sendAmount).toString(16),
          chainId: "0xaa36a7",
        }],
      });
      // Result is signature (not tx hash — raw signing unavailable)
      setTxResult({ ok: true, signature: result as string });
      void refreshBalance(address);
    } catch (err: unknown) {
      const e = err as { code?: number; message?: string };
      if (e.code === 4001) {
        setTxResult({ ok: false, error: "Rejected by user." });
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

  // ── Connected state ───────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto w-full">
      {/* Account bar */}
      <div className="flex items-center justify-between p-4 bg-white rounded-2xl shadow-sm border border-gray-100 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500" />
          <div>
            <p className="text-xs text-gray-400">Connected</p>
            <p className="text-sm font-mono font-medium">
              {address.slice(0, 8)}…{address.slice(-6)}
            </p>
          </div>
        </div>
        <div className="text-right">
          <div className="flex items-center gap-1 justify-end">
            <p className="text-lg font-bold">{balance || "—"} <span className="text-sm font-normal text-gray-500">ETH</span></p>
            <button
              onClick={() => refreshBalance(address)}
              disabled={balanceLoading}
              className={`text-gray-400 hover:text-indigo-600 ${balanceLoading ? "animate-spin" : ""}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
          <a
            href="https://www.alchemy.com/faucets/ethereum-sepolia"
            target="_blank" rel="noopener noreferrer"
            className="text-xs text-indigo-500 hover:underline"
          >
            Get test ETH ↗
          </a>
        </div>
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
              disabled={sending || !isAddress(sendTo) || !sendAmount}
              className="w-full bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 transition-colors"
            >
              {sending ? "Waiting for wallet…" : "Send"}
            </button>
          </form>

          {txResult && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${txResult.ok ? "bg-green-50 border border-green-200 text-green-800" : "bg-red-50 border border-red-200 text-red-700"}`}>
              {txResult.ok ? (
                <>
                  <p className="font-medium">✓ Transaction signed</p>
                  <p className="text-xs mt-1 text-gray-500">
                    Signature: <span className="font-mono">{txResult.signature?.slice(0, 20)}…</span>
                  </p>
                  <p className="text-xs mt-1 text-amber-700">
                    Note: on-chain broadcast requires raw secp256k1 signing — this OpenSigner build uses EIP-191.
                  </p>
                </>
              ) : (
                <p>✗ {txResult.error}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Receive tab */}
      {tab === "receive" && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 text-center space-y-3">
          <p className="text-xs text-gray-500 font-medium">Your Sepolia address</p>
          <div className="p-3 bg-gray-50 rounded-lg font-mono text-xs break-all text-gray-800">
            {address}
          </div>
          <button
            onClick={() => { void navigator.clipboard.writeText(address); }}
            className="text-indigo-600 text-sm hover:underline"
          >
            Copy address
          </button>
          <div className="pt-1">
            <a
              href={`https://sepolia.etherscan.io/address/${address}`}
              target="_blank" rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-indigo-600"
            >
              View on Sepolia Etherscan ↗
            </a>
          </div>
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
