"use client";
import { useSyncExternalStore } from "react";
import { walletProvider } from "./provider";
import { DEFAULT_NETWORK_ID, getNetwork } from "./networks";

function subscribeNetwork(notify: () => void) {
  walletProvider.on("chainChanged", notify);
  return () => { walletProvider.removeListener("chainChanged", notify); };
}
export function useWalletNetwork() {
  const id = useSyncExternalStore(subscribeNetwork, () => walletProvider.networkId, () => DEFAULT_NETWORK_ID);
  return getNetwork(id);
}

function subscribeBusy(notify: () => void) {
  walletProvider.on("transactionChanged", notify);
  const off = walletProvider.addPendingListener(notify);
  return () => { walletProvider.removeListener("transactionChanged", notify); off(); };
}
export function useWalletBusy() {
  return useSyncExternalStore(subscribeBusy,
    () => walletProvider.transactionActive || !!walletProvider.pendingRequest,
    () => false);
}
