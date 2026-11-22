"use client";
import dynamic from "next/dynamic";

const DApp = dynamic(() => import("./DApp"), { ssr: false });
const WalletWidget = dynamic(() => import("./WalletWidget"), { ssr: false });

export default function ClientLayout() {
  return (
    <div className="min-h-screen bg-gray-50 flex">
      <main className="flex-1 p-8">
        <div className="max-w-2xl mx-auto">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Sepolia dApp</h1>
            <p className="text-gray-500 mt-1 text-sm">
              Connect your embedded wallet to send and receive ETH on Sepolia testnet.
            </p>
          </div>
          <DApp />
        </div>
      </main>
      <aside className="shrink-0 p-4 flex items-start pt-8">
        <WalletWidget />
      </aside>
    </div>
  );
}
