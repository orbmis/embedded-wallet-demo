import { createPublicClient, http, recoverMessageAddress, getAddress, type Hex } from "viem";
import { DEFAULT_NETWORK_ID, getNetwork, getRpcUrl, type NetworkId } from "./networks";

export function getPublicTransport(id: NetworkId) {
  return http(getRpcUrl(id));
}

export function getPublicClient(id: NetworkId) {
  return createPublicClient({ chain: getNetwork(id).chain, transport: getPublicTransport(id) });
}

export async function getBalance(address: string, id: NetworkId = DEFAULT_NETWORK_ID): Promise<string> {
  const bal = await getPublicClient(id).getBalance({ address: getAddress(address) });
  // Round down using integer arithmetic so large balances retain precision.
  const units = bal / 1_000_000_000_000n;
  return `${units / 1_000_000n}.${(units % 1_000_000n).toString().padStart(6, "0")}`;
}

export async function verifySignature(
  address: string,
  message: string,
  signature: Hex,
): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({ message, signature });
    return recovered.toLowerCase() === address.toLowerCase();
  } catch {
    return false;
  }
}
