"use client";

// EIP-6963 provider info type
export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export type PendingRequestMethod =
  | "eth_requestAccounts"
  | "personal_sign"
  | "eth_sendTransaction";

export interface PendingRequest {
  id: string;
  method: PendingRequestMethod;
  params: unknown[];
  resolve: (value: unknown) => void;
  reject: (err: { code: number; message: string }) => void;
}

type EventMap = {
  accountsChanged: string[];
  chainChanged: string;
  connect: { chainId: string };
  disconnect: Error;
};

class EIP1193Provider {
  readonly isOpenSigner = true;

  private _accounts: string[] = [];
  private _chainId = "0xaa36a7"; // Sepolia
  private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  pendingRequest: PendingRequest | null = null;
  onPendingRequest: ((req: PendingRequest | null) => void) | null = null;

  get accounts() { return [...this._accounts]; }
  get chainId() { return this._chainId; }
  get isConnected() { return this._accounts.length > 0; }

  setAccount(address: string | null): void {
    const next = address ? [address] : [];
    if (next[0] !== this._accounts[0]) {
      this._accounts = next;
      this._emit("accountsChanged", next);
      if (next.length > 0) this._emit("connect", { chainId: this._chainId });
      else this._emit("disconnect", new Error("Wallet disconnected"));
    }
  }

  async request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
    switch (method) {
      case "eth_chainId":       return this._chainId;
      case "net_version":       return "11155111";
      case "eth_accounts":      return this._accounts;
      case "eth_requestAccounts":
        if (this._accounts.length > 0) return this._accounts;
        return this._queue("eth_requestAccounts", params);
      case "personal_sign":
      case "eth_sendTransaction":
        return this._queue(method as PendingRequestMethod, params);
      default:
        throw { code: 4200, message: `${method} not supported by this wallet` };
    }
  }

  private _queue(method: PendingRequestMethod, params: unknown[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pendingRequest = { id: crypto.randomUUID(), method, params, resolve, reject };
      this.onPendingRequest?.(this.pendingRequest);
    });
  }

  approvePending(result: unknown): void {
    if (!this.pendingRequest) return;
    this.pendingRequest.resolve(result);
    this.pendingRequest = null;
    this.onPendingRequest?.(null);
  }

  rejectPending(): void {
    if (!this.pendingRequest) return;
    this.pendingRequest.reject({ code: 4001, message: "User rejected the request." });
    this.pendingRequest = null;
    this.onPendingRequest?.(null);
  }

  on(event: string, fn: (...args: unknown[]) => void): this {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event)!.add(fn);
    return this;
  }
  removeListener(event: string, fn: (...args: unknown[]) => void): this {
    this._listeners.get(event)?.delete(fn);
    return this;
  }
  private _emit(event: string, ...args: unknown[]): void {
    this._listeners.get(event)?.forEach(fn => fn(...args));
  }
}

// Singleton shared between WalletWidget and DApp
export const walletProvider = new EIP1193Provider();

const ICON = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <rect width="100" height="100" rx="20" fill="#4F46E5"/>
    <text y="68" x="50" font-size="52" text-anchor="middle" fill="white">🔑</text>
  </svg>`,
)}`;

export const PROVIDER_INFO: EIP6963ProviderInfo = {
  uuid: "b4c2e1a0-7f3d-4e9b-a1f2-8c5d6e7a9b0c",
  name: "OpenSigner Wallet",
  icon: ICON,
  rdns: "xyz.openfort.opensigner",
};

export function announceEIP6963Provider(): () => void {
  if (typeof window === "undefined") return () => {};

  const detail = Object.freeze({ info: PROVIDER_INFO, provider: walletProvider });

  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", { detail, bubbles: true, cancelable: false }),
    );

  announce();

  window.addEventListener("eip6963:requestProvider", announce);
  return () => window.removeEventListener("eip6963:requestProvider", announce);
}
