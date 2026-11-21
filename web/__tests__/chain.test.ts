import { describe, it, expect } from "vitest";
import { verifySignature } from "../lib/chain";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { signMessage } from "viem/accounts";
import type { Hex } from "viem";

describe("verifySignature", () => {
  it("verifies a valid EIP-191 signature", async () => {
    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    const message = "hello opensigner";
    const sig = await signMessage({ privateKey: pk, message }) as Hex;
    const ok = await verifySignature(account.address, message, sig);
    expect(ok).toBe(true);
  });

  it("rejects a signature from the wrong key", async () => {
    const pk1 = generatePrivateKey();
    const pk2 = generatePrivateKey();
    const account1 = privateKeyToAccount(pk1);
    const message = "hello opensigner";
    const sig = await signMessage({ privateKey: pk2, message }) as Hex;
    const ok = await verifySignature(account1.address, message, sig);
    expect(ok).toBe(false);
  });

  it("returns false for a malformed signature", async () => {
    const ok = await verifySignature("0x" + "a".repeat(40), "msg", "0xbad" as Hex);
    expect(ok).toBe(false);
  });
});
