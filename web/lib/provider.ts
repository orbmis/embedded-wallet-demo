"use client";
import { DEFAULT_NETWORK_ID, getNetwork, NETWORK_STORAGE_KEY, type NetworkId } from "./networks";

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

export interface TransactionDetails {
  from: string;
  to: string;
  valueWei: string;
  chainId: number;
}

export interface PendingRequest {
  transaction?: TransactionDetails;
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
  private _networkId: NetworkId = DEFAULT_NETWORK_ID;
  private _transactionActive = false;
  private _listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  pendingRequest: PendingRequest | null = null;
  private _pendingListeners = new Set<(req: PendingRequest | null) => void>();

  addPendingListener(fn: (req: PendingRequest | null) => void): () => void {
    this._pendingListeners.add(fn);
    return () => this._pendingListeners.delete(fn);
  }

  private _notifyPending(req: PendingRequest | null): void {
    this._pendingListeners.forEach(fn => fn(req));
  }

  get accounts() { return [...this._accounts]; }
  get chainId() { return `0x${this._networkId.toString(16)}`; }
  get networkId() { return this._networkId; }
  get transactionActive() { return this._transactionActive; }

  beginTransaction(id: NetworkId): () => void {
    if (id !== this._networkId) throw new Error("Network changed. Please prepare the transaction again.");
    if (this._transactionActive || this.pendingRequest) throw new Error("A wallet request is already in progress");
    this._transactionActive = true;
    this._emit("transactionChanged");
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this._transactionActive = false;
      this._emit("transactionChanged");
    };
  }

  private _switchNetwork(id: NetworkId): void {
    getNetwork(id);
    if (id === this._networkId) return;
    if (this._transactionActive || this.pendingRequest) {
      throw { code: -32002, message: "Wait for the current wallet request to finish before switching networks." };
    }
    this._networkId = id;
    try { window.localStorage.setItem(NETWORK_STORAGE_KEY, String(id)); } catch { /* storage may be unavailable */ }
    this._emit("chainChanged", this.chainId);
  }
  get isConnected() { return this._accounts.length > 0; }

  setAccount(address: string | null): void {
    const next = address ? [address] : [];
    if (next[0] !== this._accounts[0]) {
      this._accounts = next;
      this._emit("accountsChanged", next);
      if (next.length > 0) this._emit("connect", { chainId: this.chainId });
      else this._emit("disconnect", new Error("Wallet disconnected"));
    }
  }

  async request({ method, params = [], transaction }: { method: string; params?: unknown[]; transaction?: TransactionDetails }): Promise<unknown> {
    switch (method) {
      case "eth_chainId":       return this.chainId;
      case "net_version":       return String(this._networkId);
      case "wallet_switchEthereumChain": {
        const id = (params[0] as { chainId?: unknown } | undefined)?.chainId;
        if (typeof id !== "string" || !/^0x[0-9a-f]+$/i.test(id)) {
          throw { code: -32602, message: "chainId must be a hexadecimal string" };
        }
        let network;
        try { network = getNetwork(Number(BigInt(id))); }
        catch { throw { code: 4902, message: "Unsupported network" }; }
        this._switchNetwork(network.chain.id);
        return null;
      }
      case "eth_accounts":      return this._accounts;
      case "eth_requestAccounts":
        if (this._accounts.length > 0) return this._accounts;
        return this._queue("eth_requestAccounts", params);
      case "personal_sign":
      case "eth_sendTransaction":
        return this._queue(method as PendingRequestMethod, params, transaction);
      default:
        throw { code: 4200, message: `${method} not supported by this wallet` };
    }
  }

  private _queue(method: PendingRequestMethod, params: unknown[], transaction?: TransactionDetails): Promise<unknown> {
    if (this.pendingRequest) return Promise.reject({ code: -32002, message: "A wallet request is already pending" });
    if (transaction && transaction.chainId !== this._networkId) {
      return Promise.reject({ code: 4901, message: "Transaction network does not match the selected network" });
    }
    return new Promise((resolve, reject) => {
      this.pendingRequest = { id: crypto.randomUUID(), method, params, resolve, reject, transaction: transaction ? { ...transaction } : undefined };
      this._notifyPending(this.pendingRequest);
    });
  }

  approvePending(result: unknown): void {
    if (!this.pendingRequest) return;
    this.pendingRequest.resolve(result);
    this.pendingRequest = null;
    this._notifyPending(null);
  }

  rejectPending(): void {
    if (!this.pendingRequest) return;
    this.pendingRequest.reject({ code: 4001, message: "User rejected the request." });
    this.pendingRequest = null;
    this._notifyPending(null);
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
