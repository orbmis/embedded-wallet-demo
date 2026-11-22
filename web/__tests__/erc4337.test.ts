import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeFunctionData, parseAbi, recoverMessageAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { entryPoint07Address, getUserOperationHash } from "viem/account-abstraction";
import { decode7579Calls } from "permissionless/utils";
import type { NexusAccount } from "@biconomy/abstractjs";
import { DEFAULT_NETWORK_ID, NETWORKS } from "../lib/networks";
import { walletProvider } from "../lib/provider";

const fixtures = vi.hoisted(() => ({
  send: vi.fn(),
  wait: vi.fn(),
  createClient: vi.fn(),
  rpcChainId: undefined as number | undefined,
}));
vi.mock("../lib/chain", async () => {
  const { createPublicClient, custom, encodeAbiParameters } = await import("viem");
  const { getNetwork } = await import("../lib/networks");
  const getPublicTransport = (id: number) => custom({ request: async ({ method, params }) => {
    if (method === "eth_chainId") return `0x${(fixtures.rpcChainId ?? id).toString(16)}`;
    if (method === "eth_getCode") {
      return ["0x3333333333333333333333333333333333333333", "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a"].includes(params[0].toLowerCase()) ? "0x" : "0x1234";
    }
    if (method === "eth_call") {
      if (params[0].data === "0x9cfd7cff") return encodeAbiParameters([{ type: "string" }], ["biconomy.nexus.1.3.3"]);
      return encodeAbiParameters([{ type: "address" }], ["0x3333333333333333333333333333333333333333"]);
    }
    throw new Error(`Unexpected public RPC: ${method}`);
  } });
  return { getPublicTransport, getPublicClient: (id: number) => createPublicClient({ chain: getNetwork(id).chain, transport: getPublicTransport(id) }) };
});
vi.mock("permissionless", () => ({ createSmartAccountClient: fixtures.createClient }));
vi.stubEnv("NEXT_PUBLIC_PIMLICO_API_KEY", "fixture-key");
const { setupSmartAccount, NEXUS_CONFIG } = await import("../lib/erc4337");
const owner = privateKeyToAccount(`0x${"11".repeat(32)}`);
const recipient = "0x2222222222222222222222222222222222222222";
const userOpHash = `0x${"ab".repeat(32)}` as Hex;
const txHash = `0x${"cd".repeat(32)}` as Hex;
const operation = {
  callData: "0x" as Hex, callGasLimit: 100000n, verificationGasLimit: 100000n,
  preVerificationGas: 50000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, nonce: 0n, signature: "0x" as Hex,
};

beforeEach(async () => {
  await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${DEFAULT_NETWORK_ID.toString(16)}` }] });
  vi.clearAllMocks();
  fixtures.rpcChainId = undefined;
  walletProvider.setAccount(owner.address);
  fixtures.send.mockResolvedValue(userOpHash);
  fixtures.wait.mockResolvedValue({ success: true, receipt: { transactionHash: txHash } });
  fixtures.createClient.mockImplementation(() => ({ sendUserOperation: fixtures.send, waitForUserOperationReceipt: fixtures.wait }));
});

function nexus(): NexusAccount {
  return fixtures.createClient.mock.calls[0][0].account;
}

describe("Nexus integration", () => {
  it("rejects a public RPC configured for the wrong chain", async () => {
    fixtures.rpcChainId = 1;
    await expect(setupSmartAccount(owner.address)).rejects.toThrow("wrong network");
    expect(fixtures.createClient).not.toHaveBeenCalled();
  });

  it("does not sign a prepared operation after the wallet network changes", async () => {
    await setupSmartAccount(owner.address);
    await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
    await expect(nexus().signUserOperation(operation)).rejects.toThrow("network changed before signing");
    expect(walletProvider.pendingRequest).toBeNull();
  });

  it("pins the deployed Nexus 1.3.3 factory/validator and EntryPoint v0.7; recovery derives the same account", async () => {
    const first = await setupSmartAccount(owner.address);
    const account = nexus();
    const second = await setupSmartAccount(owner.address);
    expect(first.saAddress).toBe(second.saAddress);
    expect(account.entryPoint.address).toBe(entryPoint07Address);
    expect(account.entryPoint.version).toBe("0.7");
    const factoryArgs = await account.getFactoryArgs();
    expect(factoryArgs.factory).toBe(NEXUS_CONFIG.factoryAddress);
    const deployment = decodeFunctionData({
      abi: parseAbi(["function createAccount(bytes initData, bytes32 salt) returns (address)"]),
      data: factoryArgs.factoryData!,
    });
    expect(deployment.args[0].toLowerCase()).toContain(owner.address.slice(2).toLowerCase());
    expect(deployment.args[1]).toBe(`0x${"00".repeat(32)}`);
    expect(NEXUS_CONFIG.accountId).toBe("biconomy.nexus.1.3.3");
    const calls = await account.encodeCalls([{ to: recipient, value: 123n, data: "0x" }]);
    const decoded = decode7579Calls(calls);
    // ERC-7579 execution type 0x00 reverts on failure (0x01 is try mode).
    const execution = decodeFunctionData({
      abi: parseAbi(["function execute(bytes32 mode, bytes executionCalldata)"]), data: calls,
    });
    expect(execution.args[0].slice(0, 6)).toBe("0x0000");
    expect(decoded.callData).toEqual([{ to: recipient, value: 123n, data: "0x" }]);
  });

  it.each(NETWORKS)("signs a chain-bound Nexus operation on $name with transfer details", async network => {
    const id = network.chain.id;
    await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${id.toString(16)}` }] });
    const setup = await setupSmartAccount(owner.address, id);
    let signedHash: Hex | undefined;
    let details;
    const off = walletProvider.addPendingListener(request => {
      if (!request) return;
      expect(request.method).toBe("personal_sign");
      signedHash = request.params[0] as Hex;
      details = request.transaction;
      void owner.signMessage({ message: { raw: signedHash } }).then(sig => walletProvider.approvePending(sig));
    });
    fixtures.send.mockImplementationOnce(async () => {
      const signature = await nexus().signUserOperation(operation);
      const expected = getUserOperationHash({
        userOperation: { ...operation, sender: setup.saAddress, signature: "0x" },
        entryPointAddress: entryPoint07Address, entryPointVersion: "0.7", chainId: id,
      });
      expect(signedHash).toBe(expected);
      expect(await recoverMessageAddress({ message: { raw: expected }, signature })).toBe(owner.address);
      return userOpHash;
    });
    try {
      await expect(setup.send(recipient, 123n)).resolves.toEqual({ txHash, userOpHash });
      expect(details).toEqual({ from: setup.saAddress, to: recipient, valueWei: "123", chainId: id });
      expect(walletProvider.pendingRequest).toBeNull();
    } finally { off(); }
  });

  it("reports reverted operations as failures and permits another send", async () => {
    const setup = await setupSmartAccount(owner.address);
    fixtures.wait.mockResolvedValueOnce({ success: false, reason: "execution reverted", receipt: { transactionHash: txHash } });
    await expect(setup.send(recipient, 1n)).rejects.toThrow("Transaction execution failed");
    await expect(setup.send(recipient, 1n)).resolves.toEqual({ txHash, userOpHash });
  });

  it("preserves the submitted hash when receipt retrieval fails", async () => {
    const setup = await setupSmartAccount(owner.address);
    fixtures.wait.mockRejectedValueOnce(new Error("timeout"));
    await expect(setup.send(recipient, 1n)).rejects.toMatchObject({ userOpHash });
  });

  it("preserves user rejection and does not wait for an unsubmitted operation", async () => {
    const setup = await setupSmartAccount(owner.address);
    fixtures.send.mockRejectedValueOnce({ code: 4001, message: "User rejected" });
    await expect(setup.send(recipient, 1n)).rejects.toMatchObject({ code: 4001 });
    expect(fixtures.wait).not.toHaveBeenCalled();
  });

  it("blocks overlapping sends while awaiting confirmation", async () => {
    const setup = await setupSmartAccount(owner.address);
    let finish!: (receipt: unknown) => void;
    fixtures.wait.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = setup.send(recipient, 1n);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(setup.send(recipient, 2n)).rejects.toThrow("already in progress");
    finish({ success: true, receipt: { transactionHash: txHash } });
    await first;
  });
});
