import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { walletProvider } from "../lib/provider";

beforeEach(async () => {
  await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] });
});

afterEach(() => {
  walletProvider.rejectPending();
});

describe("wallet approval lifecycle", () => {
  it("keeps a snapshot of transfer details on the signing request without leaking to the next request", async () => {
    const transaction = {
      from: "0x1111111111111111111111111111111111111111",
      to: "0x2222222222222222222222222222222222222222",
      valueWei: "1000000000000000",
      chainId: 11155111,
    };
    const result = walletProvider.request({ method: "personal_sign", params: ["0xhash"], transaction });
    transaction.valueWei = "0";
    expect(walletProvider.pendingRequest?.transaction).toEqual({
      ...transaction, valueWei: "1000000000000000",
    });
    walletProvider.approvePending("0xsignature");
    await result;
    const next = walletProvider.request({ method: "personal_sign", params: ["0xmessage"] });
    expect(walletProvider.pendingRequest?.transaction).toBeUndefined();
    walletProvider.approvePending("0xsignature");
    await next;
  });

  it("notifies every subscriber when an approved request closes", async () => {
    const wallet = vi.fn();
    const dapp = vi.fn();
    const offWallet = walletProvider.addPendingListener(wallet);
    const offDapp = walletProvider.addPendingListener(dapp);
    try {
      const result = walletProvider.request({ method: "personal_sign", params: ["0x1234"] });
      expect(wallet.mock.lastCall?.[0]?.method).toBe("personal_sign");
      expect(dapp.mock.lastCall?.[0]?.method).toBe("personal_sign");
      walletProvider.approvePending("0xsigned");
      await expect(result).resolves.toBe("0xsigned");
      expect(walletProvider.pendingRequest).toBeNull();
      expect(wallet).toHaveBeenLastCalledWith(null);
      expect(dapp).toHaveBeenLastCalledWith(null);
    } finally {
      offWallet();
      offDapp();
    }
  });

  it("unsubscribing one view leaves the remaining view subscribed", async () => {
    const removed = vi.fn();
    const active = vi.fn();
    const offRemoved = walletProvider.addPendingListener(removed);
    const offActive = walletProvider.addPendingListener(active);
    offRemoved();
    try {
      const result = walletProvider.request({ method: "personal_sign" });
      const rejected = expect(result).rejects.toMatchObject({ code: 4001 });
      walletProvider.rejectPending();
      await rejected;
      expect(removed).not.toHaveBeenCalled();
      expect(active).toHaveBeenLastCalledWith(null);
      expect(walletProvider.pendingRequest).toBeNull();
    } finally {
      offActive();
    }
  });
});


describe("network switching", () => {
  it("updates both chain methods and emits chainChanged without clearing the account", async () => {
    walletProvider.setAccount("0x1111111111111111111111111111111111111111");
    const changed = vi.fn();
    walletProvider.on("chainChanged", changed);
    try {
      await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
      await expect(walletProvider.request({ method: "eth_chainId" })).resolves.toBe("0x2105");
      await expect(walletProvider.request({ method: "net_version" })).resolves.toBe("8453");
      expect(changed).toHaveBeenCalledExactlyOnceWith("0x2105");
      expect(walletProvider.accounts).toHaveLength(1);
    } finally { walletProvider.removeListener("chainChanged", changed); }
  });

  it.each([{ chainId: "0xa" }, { chainId: "8453" }, { chainId: null }])("rejects unsupported or malformed switch $chainId", async params => {
    await expect(walletProvider.request({ method: "wallet_switchEthereumChain", params: [params] })).rejects.toHaveProperty("code");
    expect(walletProvider.networkId).toBe(11155111);
  });

  it("locks switching through building and confirmation, then unlocks", async () => {
    const release = walletProvider.beginTransaction(11155111);
    try {
      await expect(walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] })).rejects.toMatchObject({ code: -32002 });
      expect(walletProvider.networkId).toBe(11155111);
    } finally { release(); }
    await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
    expect(walletProvider.networkId).toBe(1);
  });

  it("does not switch while an approval is pending", async () => {
    const pending = walletProvider.request({ method: "personal_sign" });
    await expect(walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] })).rejects.toMatchObject({ code: -32002 });
    walletProvider.approvePending("0xsignature");
    await pending;
  });

  it("rejects stale prepared transactions and requests for another chain", async () => {
    await walletProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
    expect(() => walletProvider.beginTransaction(11155111)).toThrow("Network changed");
    await expect(walletProvider.request({ method: "personal_sign", transaction: {
      from: "0xowner", to: "0xto", valueWei: "1", chainId: 11155111,
    } })).rejects.toMatchObject({ code: 4901 });
    expect(walletProvider.pendingRequest).toBeNull();
  });
});
