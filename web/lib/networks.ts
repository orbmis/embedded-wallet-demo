import { arbitrum, arbitrumSepolia, base, baseSepolia, mainnet, sepolia } from "viem/chains";

export const NETWORKS = [
  { chain: mainnet, name: "Ethereum", slug: "ethereum", testnet: false },
  { chain: sepolia, name: "Ethereum Sepolia", slug: "sepolia", testnet: true },
  { chain: base, name: "Base", slug: "base", testnet: false },
  { chain: baseSepolia, name: "Base Sepolia", slug: "base-sepolia", testnet: true },
  { chain: arbitrum, name: "Arbitrum One", slug: "arbitrum", testnet: false },
  { chain: arbitrumSepolia, name: "Arbitrum Sepolia", slug: "arbitrum-sepolia", testnet: true },
] as const;
export type Network = typeof NETWORKS[number];
export type NetworkId = Network["chain"]["id"];
export const DEFAULT_NETWORK_ID: NetworkId = sepolia.id;
export const NETWORK_STORAGE_KEY = "opensigner.network";

export function getNetwork(id: number): Network {
  const network = NETWORKS.find(network => network.chain.id === id);
  if (!network) throw new Error(`Unsupported network: ${id}`);
  return network;
}

// Explicit env accesses are required for Next.js to inline browser configuration.
const RPC_URLS: Record<NetworkId, string | undefined> = {
  1: process.env["NEXT_PUBLIC_RPC_URL_ETHEREUM"],
  11155111: process.env["NEXT_PUBLIC_RPC_URL_SEPOLIA"],
  8453: process.env["NEXT_PUBLIC_RPC_URL_BASE"],
  84532: process.env["NEXT_PUBLIC_RPC_URL_BASE_SEPOLIA"],
  42161: process.env["NEXT_PUBLIC_RPC_URL_ARBITRUM"],
  421614: process.env["NEXT_PUBLIC_RPC_URL_ARBITRUM_SEPOLIA"],
};
const BUNDLER_URLS: Record<NetworkId, string | undefined> = {
  1: process.env["NEXT_PUBLIC_PIMLICO_URL_ETHEREUM"],
  11155111: process.env["NEXT_PUBLIC_PIMLICO_URL_SEPOLIA"],
  8453: process.env["NEXT_PUBLIC_PIMLICO_URL_BASE"],
  84532: process.env["NEXT_PUBLIC_PIMLICO_URL_BASE_SEPOLIA"],
  42161: process.env["NEXT_PUBLIC_PIMLICO_URL_ARBITRUM"],
  421614: process.env["NEXT_PUBLIC_PIMLICO_URL_ARBITRUM_SEPOLIA"],
};

export function getRpcUrl(id: NetworkId): string {
  return RPC_URLS[id] || getNetwork(id).chain.rpcUrls.default.http[0];
}

export function getBundlerUrl(id: NetworkId): string {
  getNetwork(id);
  if (BUNDLER_URLS[id]) return BUNDLER_URLS[id];
  const key = process.env["NEXT_PUBLIC_PIMLICO_API_KEY"];
  if (key) return `https://api.pimlico.io/v2/${id}/rpc?apikey=${encodeURIComponent(key)}`;
  const legacy = process.env["NEXT_PUBLIC_PIMLICO_URL"];
  if (legacy) {
    // Preserve existing setups; only rewrite the known Pimlico chain URL format.
    const url = new URL(legacy);
    if (url.hostname === "api.pimlico.io" && /^\/v2\/[^/]+\/rpc\/?$/.test(url.pathname)) {
      url.pathname = `/v2/${id}/rpc`;
      return url.toString();
    }
    if (id === DEFAULT_NETWORK_ID) return legacy;
  }
  throw new Error(`Configure a Pimlico API key or network-specific bundler URL for ${getNetwork(id).name}`);
}

export function getUserOperationUrl(id: NetworkId, hash: string): string {
  return `https://jiffyscan.xyz/userOpHash/${hash}?network=${getNetwork(id).slug}`;
}
