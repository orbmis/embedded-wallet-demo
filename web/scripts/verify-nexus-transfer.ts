// Opt-in live testnet test: deploys a fresh account and submits a sponsored zero-ETH transfer.
// The generated test key is kept in memory and never uses the user's wallet.
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { DEFAULT_NETWORK_ID, getNetwork } from "../lib/networks";
import { setupSmartAccount } from "../lib/erc4337";
import { walletProvider } from "../lib/provider";
const network = getNetwork(Number(process.argv[2] ?? DEFAULT_NETWORK_ID));
if (!network.testnet) throw new Error("Live transfer checks are restricted to testnets");
await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${network.chain.id.toString(16)}` }] });
const testOwner = privateKeyToAccount(generatePrivateKey());
walletProvider.setAccount(testOwner.address);
let approvals = 0;
const off = walletProvider.addPendingListener(request => {
  if (!request) return;
  if (request.method !== "personal_sign" || !request.transaction || request.transaction.valueWei !== "0") {
    walletProvider.rejectPending();
    return;
  }
  approvals++;
  void testOwner.signMessage({ message: { raw: request.params[0] as Hex } }).then(signature => walletProvider.approvePending(signature));
});
try {
  const account = await setupSmartAccount(testOwner.address, network.chain.id);
  console.log(`Testing a sponsored zero-ETH transfer on ${network.name}; no user wallet is used.`);
  const result = await account.send(testOwner.address, 0n);
  if (approvals !== 1) throw new Error(`Expected one approval, received ${approvals}`);
  console.log(JSON.stringify({ ...result, approvals }));
} catch (err) {
  const error = err as { shortMessage?: string; message?: string; userOpHash?: string };
  console.error((error.shortMessage ?? error.message ?? "Test transfer failed").replace(/https?:\/\/\S+/g, "[RPC URL]"));
  if (error.userOpHash) console.error(`Submitted operation: ${error.userOpHash}`);
  process.exitCode = 1;
} finally { off(); }
