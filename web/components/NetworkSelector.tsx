"use client";
import { useEffect, useState } from "react";
import { NETWORKS, NETWORK_STORAGE_KEY } from "@/lib/networks";
import { walletProvider } from "@/lib/provider";
import { useWalletBusy, useWalletNetwork } from "@/lib/useWalletNetwork";

export default function NetworkSelector() {
  const network = useWalletNetwork();
  const busy = useWalletBusy();
  const [error, setError] = useState("");
  async function select(id: number) {
    try {
      await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${id.toString(16)}` }] });
      setError("");
    } catch (err) { setError((err as Error).message); }
  }
  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(NETWORK_STORAGE_KEY));
      if (NETWORKS.some(item => item.chain.id === saved)) void select(saved);
    } catch { /* Keep Sepolia when storage is unavailable. */ }
  }, []);
  return (
    <div className="relative">
      <select aria-label="Network" value={network.chain.id} disabled={busy}
        title={busy ? "Wait for the current wallet request to finish" : "Select network"}
        onChange={event => void select(Number(event.target.value))}
        className="max-w-44 sm:max-w-none border border-slate-200 rounded-lg bg-white px-2 py-1.5 text-xs text-slate-700 disabled:opacity-50">
        <optgroup label="Testnets">
          {NETWORKS.filter(item => item.testnet).map(item => <option key={item.chain.id} value={item.chain.id}>{item.name}</option>)}
        </optgroup>
        <optgroup label="Mainnets · real ETH">
          {NETWORKS.filter(item => !item.testnet).map(item => <option key={item.chain.id} value={item.chain.id}>{item.name} Mainnet</option>)}
        </optgroup>
      </select>
      {error && <p role="alert" className="absolute right-0 top-full z-20 mt-1 w-64 rounded-lg border border-red-100 bg-white p-2 text-xs text-red-700 shadow">{error}</p>}
    </div>
  );
}
