import ClientShell from "@/components/ClientShell";

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-8">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">
          Embedded Wallet Demo
        </h1>
        <p className="text-gray-600 mb-2">
          A non-custodial embedded wallet built on{" "}
          <a
            href="https://github.com/openfort-xyz/opensigner"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenSigner
          </a>
          .
        </p>
        <p className="text-sm text-gray-400">
          Keys are split across device, hot, and cold storage. Sign in to get
          started.
        </p>
      </div>
      <ClientShell />
    </main>
  );
}
