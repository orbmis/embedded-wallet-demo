// Read-only network smoke check: never signs or submits a transaction.
import { createBundlerClient } from "viem/account-abstraction";
import { http } from "viem";
import { getPublicClient } from "../lib/chain";
import { getBundlerUrl, getNetwork, NETWORKS, DEFAULT_NETWORK_ID, type NetworkId } from "../lib/networks";
import { NEXUS_CONFIG, NEXUS_ENTRY_POINT, setupSmartAccount } from "../lib/erc4337";
import { walletProvider } from "../lib/provider";

async function verify(id: NetworkId) {
  const network = getNetwork(id);
  const client = getPublicClient(id);
  let stage = "public RPC";
  try {
    if (await client.getChainId() !== id) throw new Error("Wrong RPC chain");
    for (const [label, address] of [
      ["factory", NEXUS_CONFIG.factoryAddress], ["validator", NEXUS_CONFIG.validatorAddress],
      ["implementation", NEXUS_CONFIG.implementationAddress], ["bootstrap", NEXUS_CONFIG.bootStrapAddress],
      ["EntryPoint", NEXUS_ENTRY_POINT.address],
    ] as const) {
      stage = label;
      const code = await client.getCode({ address });
      if (!code || code === "0x") throw new Error("Contract is not deployed");
    }
    stage = "bundler EntryPoint support";
    const bundler = createBundlerClient({ transport: http(getBundlerUrl(id)) });
    if (!(await bundler.getSupportedEntryPoints()).some(address => address.toLowerCase() === NEXUS_ENTRY_POINT.address.toLowerCase())) {
      throw new Error("EntryPoint v0.7 unsupported");
    }
    stage = "address derivation";
    const owner = "0x1111111111111111111111111111111111111111";
    const first = await setupSmartAccount(owner, id);
    const second = await setupSmartAccount(owner, id);
    if (first.saAddress !== second.saAddress) throw new Error("Unstable address");
    console.log(`${network.name} (${id}): deployments, bundler and stable Nexus address verified (${first.saAddress})`);
  } catch {
    // Avoid printing credential-bearing URLs from nested transport errors.
    console.error(`${network.name} (${id}): failed at ${stage}`);
    process.exitCode = 1;
  }
}
const ids = process.argv.includes("--all") ? NETWORKS.map(network => network.chain.id)
  : [getNetwork(Number(process.argv[2] ?? DEFAULT_NETWORK_ID)).chain.id];
walletProvider.setAccount("0x1111111111111111111111111111111111111111");
await Promise.all(ids.map(verify));
