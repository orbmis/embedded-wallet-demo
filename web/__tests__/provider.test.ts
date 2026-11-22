import { afterEach, describe, expect, it, vi } from "vitest";
import { walletProvider } from "../lib/provider";

afterEach(() => {
  walletProvider.rejectPending();
});

describe("wallet approval lifecycle", () => {
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
