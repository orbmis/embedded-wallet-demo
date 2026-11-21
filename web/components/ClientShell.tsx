"use client";
import dynamic from "next/dynamic";

const WalletWidget = dynamic(() => import("./WalletWidget"), { ssr: false });

export default function ClientShell() {
  return <WalletWidget />;
}
