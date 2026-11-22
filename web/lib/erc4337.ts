"use client";
import { createWalletClient, custom, http, type Address, type Hash, type Hex } from "viem";
import { sepolia } from "viem/chains";
import {
  ENTRYPOINT_ADDRESS_V06,
  createSmartAccountClient,
  walletClientToSmartAccountSigner,
} from "permissionless";
import { signerToSimpleSmartAccount } from "permissionless/accounts";
import {
  createPimlicoBundlerClient,
  createPimlicoPaymasterClient,
} from "permissionless/clients/pimlico";
import { walletProvider } from "./provider";
import { publicClient } from "./chain";

const FACTORY = "0x9406Cc6185a346906296840746125a0E44976454" as Address;

const BUNDLER_URL = process.env["NEXT_PUBLIC_PIMLICO_URL"] ?? "";

function assertBundlerUrl(): string {
  if (!BUNDLER_URL) {
    throw new Error(
      "No bundler URL configured. Add NEXT_PUBLIC_PIMLICO_URL to web/.env.local — " +
        "free key at https://dashboard.pimlico.io",
    );
  }
  return BUNDLER_URL;
}

// When sendTransaction times out, the userOpHash is embedded in the error.
// Pull it out so we can poll separately.
function extractUserOpHash(errorMessage: string): Hex | null {
  const match = errorMessage.match(/0x[0-9a-fA-F]{64}/);
  return match ? (match[0] as Hex) : null;
}

// Poll the bundler directly for the receipt — bypasses the client-side timeout.
async function pollReceipt(
  bundlerUrl: string,
  userOpHash: Hex,
  maxMs = 90_000,
): Promise<Hex | null> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getUserOperationReceipt",
          params: [userOpHash],
        }),
      });
      const json = (await res.json()) as { result?: { receipt?: { transactionHash?: string } } };
      const txHash = json.result?.receipt?.transactionHash;
      if (txHash) return txHash as Hex;
    } catch { /* ignore transient fetch errors */ }
    await new Promise(r => setTimeout(r, 3_000));
  }
  return null;
}

export interface SendResult {
  txHash: Hex;
  userOpHash?: Hex; // present when we got the hash but had to poll manually
}

export interface SmartAccountSetup {
  saAddress: Address;
  send(to: Address, valueWei: bigint): Promise<SendResult>;
}

export async function setupSmartAccount(
  ownerAddress: Address,
): Promise<SmartAccountSetup> {
  const bundlerUrl = assertBundlerUrl();

  const walletClient = createWalletClient({
    account: ownerAddress,
    chain: sepolia,
    transport: custom(walletProvider),
  });

  const signer = walletClientToSmartAccountSigner(walletClient);

  const simpleAccount = await signerToSimpleSmartAccount(publicClient, {
    signer,
    factoryAddress: FACTORY,
    entryPoint: ENTRYPOINT_ADDRESS_V06,
  });

  const bundlerClient = createPimlicoBundlerClient({
    transport: http(bundlerUrl),
    entryPoint: ENTRYPOINT_ADDRESS_V06,
  });

  const paymasterClient = createPimlicoPaymasterClient({
    transport: http(bundlerUrl),
    entryPoint: ENTRYPOINT_ADDRESS_V06,
  });

  const smartAccountClient = createSmartAccountClient({
    account: simpleAccount,
    entryPoint: ENTRYPOINT_ADDRESS_V06,
    chain: sepolia,
    bundlerTransport: http(bundlerUrl),
    middleware: {
      gasPrice: async () => (await bundlerClient.getUserOperationGasPrice()).fast,
      sponsorUserOperation: paymasterClient.sponsorUserOperation,
    },
  });

  return {
    saAddress: simpleAccount.address,

    async send(to: Address, valueWei: bigint): Promise<SendResult> {
      try {
        const txHash = await smartAccountClient.sendTransaction({
          to,
          value: valueWei,
          data: "0x",
        });
        return { txHash: txHash as Hex };
      } catch (err) {
        const msg = (err as Error).message ?? "";
        const isTimeout =
          msg.toLowerCase().includes("timed out") ||
          msg.toLowerCase().includes("timeout");

        if (isTimeout) {
          const userOpHash = extractUserOpHash(msg);
          if (userOpHash) {
            // UserOp reached the bundler — poll the bundler directly for up to 90s
            const txHash = await pollReceipt(bundlerUrl, userOpHash);
            if (txHash) return { txHash, userOpHash };
            // Still unconfirmed — surface the userOpHash so the UI can link to JiffyScan
            const e = new Error(`UserOp submitted but not yet confirmed.`);
            (e as unknown as Record<string, unknown>)["userOpHash"] = userOpHash;
            throw e;
          }
        }
        throw err;
      }
    },
  };
}
