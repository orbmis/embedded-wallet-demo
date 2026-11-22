"use client";
import { createWalletClient, custom, http, type Address, type Hex } from "viem";
import { toAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { entryPoint07Address } from "viem/account-abstraction";
import { createSmartAccountClient } from "permissionless";
import { getMEEVersion, MEEVersion, toNexusAccount } from "@biconomy/abstractjs";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { walletProvider, type TransactionDetails } from "./provider";
import { publicTransport } from "./chain";

// Pin the deployed Nexus 1.3.3 suite rather than the SDK's evolving default.
export const NEXUS_CONFIG = getMEEVersion(MEEVersion.V2_2_3);
export const NEXUS_INDEX = 0n;
export const NEXUS_ENTRY_POINT = { address: entryPoint07Address, version: "0.7" } as const;

const BUNDLER_URL = process.env["NEXT_PUBLIC_PIMLICO_URL"] ?? "";

export interface SendResult {
  txHash: Hex;
  userOpHash: Hex;
}

export interface SmartAccountSetup {
  saAddress: Address;
  send(to: Address, valueWei: bigint): Promise<SendResult>;
}

export async function setupSmartAccount(ownerAddress: Address): Promise<SmartAccountSetup> {
  if (!BUNDLER_URL) {
    throw new Error("No bundler URL configured. Add NEXT_PUBLIC_PIMLICO_URL to web/.env.local");
  }

  let transaction: TransactionDetails | undefined;
  const owner = createWalletClient({
    account: ownerAddress,
    chain: sepolia,
    transport: custom({
      request: ({ method, params }) => walletProvider.request({
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
      signMessage: args => owner.signMessage(args),
      signTypedData: async () => { throw new Error("Typed-data signing is not supported by OpenSigner"); },
      signTransaction: async () => { throw new Error("Raw transaction signing is not supported by OpenSigner"); },
    }),
    index: NEXUS_INDEX,
    chainConfiguration: { chain: sepolia, transport: publicTransport, version: NEXUS_CONFIG },
  });

  const pimlico = createPimlicoClient({
    chain: sepolia,
    transport: http(BUNDLER_URL),
    entryPoint: NEXUS_ENTRY_POINT,
  });
  const client = createSmartAccountClient({
    account,
    chain: sepolia,
    bundlerTransport: http(BUNDLER_URL),
    paymaster: pimlico,
    userOperation: {
      estimateFeesPerGas: async () => (await pimlico.getUserOperationGasPrice()).fast,
    },
  });

  return {
    saAddress: account.address,
    async send(to, valueWei) {
      if (transaction) throw new Error("A transaction is already in progress");
      transaction = { from: account.address, to, valueWei: valueWei.toString(), chainId: sepolia.id };
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
      }
    },
  };
}
