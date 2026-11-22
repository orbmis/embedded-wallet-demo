"use client";
import { createWalletClient, custom, http, type Address, type Hex } from "viem";
import { toAccount } from "viem/accounts";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { getMEEVersion, MEEVersion, toNexusAccount } from "@biconomy/abstractjs";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { walletProvider, type TransactionDetails } from "./provider";
import { getPublicClient, getPublicTransport } from "./chain";
import { DEFAULT_NETWORK_ID, getBundlerUrl, getNetwork, type NetworkId } from "./networks";

// Pin the deployed Nexus 1.3.3 suite rather than the SDK's evolving default.
export const NEXUS_CONFIG = getMEEVersion(MEEVersion.V2_2_3);
export const NEXUS_INDEX = 0n;
export const NEXUS_ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const;

export interface SendResult {
  txHash: Hex;
  userOpHash: Hex;
}

export interface SmartAccountSetup {
  saAddress: Address;
  chainId: NetworkId;
  send(to: Address, valueWei: bigint): Promise<SendResult>;
}

export async function setupSmartAccount(
  ownerAddress: Address,
  networkId: NetworkId = DEFAULT_NETWORK_ID,
  provider = walletProvider,
): Promise<SmartAccountSetup> {
  const { chain } = getNetwork(networkId);
  const bundlerUrl = getBundlerUrl(networkId);
  const publicTransport = getPublicTransport(networkId);
  if (await getPublicClient(networkId).getChainId() !== networkId) {
    throw new Error("RPC endpoint is connected to the wrong network");
  }
  if (provider !== walletProvider) {
    const current = await provider.request({ method: "eth_chainId" });
    if (Number(current) !== networkId) {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${networkId.toString(16)}` }] });
    }
  }

  let transaction: TransactionDetails | undefined;
  const owner = createWalletClient({
    account: ownerAddress,
    chain,
    transport: custom({
      request: ({ method, params }) => provider.request({
        method,
        params: params as unknown[] | undefined,
        transaction: method === "personal_sign" ? transaction : undefined,
      }),
    }),
  });

  const account = await toNexusAccount({
    // A local adapter keeps the SDK on our MPC transport, never window.ethereum.
    signer: toAccount({
      address: ownerAddress,
      signMessage: async args => {
        if (Number(await provider.request({ method: "eth_chainId" })) !== networkId) {
          throw new Error("Wallet network changed before signing");
        }
        const accounts = await provider.request({ method: "eth_accounts" }) as string[];
        if (accounts[0]?.toLowerCase() !== ownerAddress.toLowerCase()) throw new Error("Wallet account changed before signing");
        return owner.signMessage(args);
      },
      signTypedData: async () => { throw new Error("Typed-data signing is not supported by OpenSigner"); },
      signTransaction: async () => { throw new Error("Raw transaction signing is not supported by OpenSigner"); },
    }),
    index: NEXUS_INDEX,
    chainConfiguration: { chain, transport: publicTransport, version: NEXUS_CONFIG },
  });

  const pimlico = createPimlicoClient({
    chain,
    transport: http(bundlerUrl),
    entryPoint: NEXUS_ENTRY_POINT,
  });
  const client = createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(bundlerUrl),
    paymaster: pimlico,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
    },
  });

  return {
    saAddress: account.address,
    chainId: networkId,
    async send(to, valueWei) {
      if (transaction) throw new Error("A transaction is already in progress");
      const release = walletProvider.beginTransaction(networkId);
      transaction = { from: account.address, to, valueWei: valueWei.toString(), chainId: networkId };
      try {
        const userOpHash = await client.sendUserOperation({ calls: [{ to, value: valueWei, data: "0x" }] });
        // Retain the actual submitted hash; never extract a hash from error text.
        let receipt;
        try {
          receipt = await client.waitForUserOperationReceipt({ hash: userOpHash, timeout: 180_000 });
        } catch {
          throw Object.assign(new Error("UserOperation submitted; confirmation is not yet available."), { userOpHash });
        }
        if (!receipt.success) {
          throw new Error(`Transaction execution failed: ${receipt.reason || "UserOperation reverted"}`);
        }
        return { txHash: receipt.receipt.transactionHash, userOpHash };
      } finally {
        transaction = undefined;
        release();
      }
    },
  };
}
