"use client";
import { createWalletClient, custom, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import {
  ENTRYPOINT_ADDRESS_V06,
  createSmartAccountClient,
  walletClientToSmartAccountSigner,
} from "permissionless";
import { signerToSimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoBundlerClient } from "permissionless/clients/pimlico";
import { walletProvider } from "./provider";
import { publicClient } from "./chain";

// SimpleAccountFactory v1 — deterministic, same address on all EVM chains
const FACTORY = "0x9406Cc6185a346906296840746125a0E44976454" as Address;

const BUNDLER_URL = process.env["NEXT_PUBLIC_PIMLICO_URL"] ?? "";

function assertBundlerUrl(): string {
  if (!BUNDLER_URL) {
    throw new Error(
      "No bundler URL configured. Add NEXT_PUBLIC_PIMLICO_URL to web/.env.local — " +
        "get a free key at https://dashboard.pimlico.io",
    );
  }
  return BUNDLER_URL;
}

export interface SmartAccountSetup {
  saAddress: Address;
  send(to: Address, valueWei: bigint): Promise<Hex>;
}

export async function setupSmartAccount(
  ownerAddress: Address,
): Promise<SmartAccountSetup> {
  // Wrap our EIP-1193 provider as a viem WalletClient so permissionless
  // can call personal_sign through our existing approval flow.
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

  const bundlerUrl = assertBundlerUrl();

  const smartAccountClient = createSmartAccountClient({
    account: simpleAccount,
    entryPoint: ENTRYPOINT_ADDRESS_V06,
    chain: sepolia,
    bundlerTransport: http(bundlerUrl),
    middleware: {
      gasPrice: async () => {
        const bc = createPimlicoBundlerClient({
          transport: http(bundlerUrl),
          entryPoint: ENTRYPOINT_ADDRESS_V06,
        });
        return (await bc.getUserOperationGasPrice()).fast;
      },
    },
  });

  return {
    saAddress: simpleAccount.address,
    async send(to: Address, valueWei: bigint): Promise<Hex> {
      return smartAccountClient.sendTransaction({ to, value: valueWei, data: "0x" });
    },
  };
}
