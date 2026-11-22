import { afterEach, describe, expect, it, vi } from "vitest";
import { getBundlerUrl, getNetwork, getUserOperationUrl, NETWORKS } from "../lib/networks";

afterEach(() => vi.unstubAllEnvs());
describe("network routing", () => {
  it.each(NETWORKS)("routes $name to its own Pimlico endpoint", network => {
    vi.stubEnv("NEXT_PUBLIC_PIMLICO_API_KEY", "fixture-key");
    expect(new URL(getBundlerUrl(network.chain.id)).pathname).toBe(`/v2/${network.chain.id}/rpc`);
  });
  it("reuses the legacy Pimlico key without keeping the Sepolia chain path", () => {
    vi.stubEnv("NEXT_PUBLIC_PIMLICO_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_PIMLICO_URL", "https://api.pimlico.io/v2/sepolia/rpc?apikey=fixture-key");
    const url = new URL(getBundlerUrl(42161));
    expect(url.pathname).toBe("/v2/42161/rpc");
    expect(url.searchParams.get("apikey")).toBe("fixture-key");
  });
  it("never reuses a custom Sepolia endpoint on another network", () => {
    vi.stubEnv("NEXT_PUBLIC_PIMLICO_API_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_PIMLICO_URL", "https://custom-bundler.example.test/rpc");
    expect(getBundlerUrl(11155111)).toBe("https://custom-bundler.example.test/rpc");
    expect(() => getBundlerUrl(8453)).toThrow("Configure");
  });
  it("rejects unsupported chains and keeps operation explorer links network-specific", () => {
    expect(() => getNetwork(10)).toThrow("Unsupported network");
    expect(getUserOperationUrl(84532, "0xhash")).toContain("network=base-sepolia");
    expect(getUserOperationUrl(42161, "0xhash")).toContain("network=arbitrum");
  });
});
