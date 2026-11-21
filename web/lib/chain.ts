import { createPublicClient, http, recoverMessageAddress, getAddress, type Hex } from "viem";
import { sepolia } from "viem/chains";

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(),
});

export async function getSepoliaBalance(address: string): Promise<string> {
  const bal = await publicClient.getBalance({ address: getAddress(address) });
  const eth = Number(bal) / 1e18;
  return eth.toFixed(6);
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
