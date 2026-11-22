// Read-only Sepolia smoke check: never signs or submits a transaction.
import { createBundlerClient } from "viem/account-abstraction";
import { http } from "viem";
import { publicClient } from "../lib/chain";
import { NEXUS_CONFIG, NEXUS_ENTRY_POINT, setupSmartAccount } from "../lib/erc4337";
import { walletProvider } from "../lib/provider";

let stage = "configuration";
async function main() {
  const url = process.env["NEXT_PUBLIC_PIMLICO_URL"];
  if (!url) throw new Error("NEXT_PUBLIC_PIMLICO_URL is required");
  stage = "Sepolia public RPC";
  if (await publicClient.getChainId() !== 11155111) throw new Error("Expected Sepolia");
  for (const [label, address] of [
    ["Nexus factory", NEXUS_CONFIG.factoryAddress],
    ["K1 validator", NEXUS_CONFIG.validatorAddress],
    ["Nexus implementation", NEXUS_CONFIG.implementationAddress],
    ["Nexus bootstrap", NEXUS_CONFIG.bootStrapAddress],
    ["EntryPoint v0.7", NEXUS_ENTRY_POINT.address],
  ] as const) {
    stage = label;
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") throw new Error(`${label} is not deployed`);
    console.log(`${label}: deployed`);
  }
  const bundler = createBundlerClient({ transport: http(url) });
  stage = "bundler EntryPoint support";
  const entryPoints = await bundler.getSupportedEntryPoints();
  if (!entryPoints.some(address => address.toLowerCase() === NEXUS_ENTRY_POINT.address.toLowerCase())) {
    throw new Error("Bundler does not support EntryPoint v0.7");
  }
  console.log("Bundler: EntryPoint v0.7 supported");
  // Public fixture owner, unrelated to the user's wallet.
  const owner = "0x1111111111111111111111111111111111111111";
  walletProvider.setAccount(owner);
  stage = "Nexus address derivation";
  const first = await setupSmartAccount(owner);
  const second = await setupSmartAccount(owner);
  if (first.saAddress !== second.saAddress) throw new Error("Account derivation changed");
  console.log(`Nexus address derivation: stable (${first.saAddress})`);
}
main().catch(() => {
  // Do not expose credential-bearing RPC URLs from nested transport errors.
  console.error(`Nexus smoke check failed at: ${stage}. Check RPC connectivity and deployment configuration.`);
  process.exitCode = 1;
});
