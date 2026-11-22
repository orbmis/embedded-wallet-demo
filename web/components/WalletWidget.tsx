"use client";
import { useState, useEffect, useCallback } from "react";
import { authClient, signInWithGoogle, signUpEmail, signInEmail, signOut, getJwt } from "@/lib/auth";
import { create, sign, recover, disconnectIframe } from "@/lib/signer";
import { getSepoliaBalance, verifySignature } from "@/lib/chain";
import ActivityLog, { type LogEntry } from "./ActivityLog";
import type { Hex } from "viem";

type WalletState =
  | "signedOut"
  | "noWallet"
  | "needsRecovery"
  | "ready"
  | "busy";

interface WalletData {
  address: string;
  accountId: string;
  balance: string;
}

const HOT_URL = process.env["NEXT_PUBLIC_HOT_STORAGE_URL"] ?? "http://localhost:7054";
const DEV_LOGIN = process.env["NEXT_PUBLIC_DEV_EMAIL_LOGIN"] === "true";

function trunc(s: string | undefined | null, n = 8) {
  if (!s) return "(empty)";
  return s.slice(0, n) + "…";
}

export default function WalletWidget() {
  const { data: session, isPending } = authClient.useSession();

  const [state, setState] = useState<WalletState>("busy");
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [existingAccountId, setExistingAccountId] = useState<string | null>(null);
  const [existingAddress, setExistingAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copiedAddress, setCopiedAddress] = useState(false);
  const [message, setMessage] = useState("hello opensigner");
  const [sigResult, setSigResult] = useState<{ sig: string; ok: boolean } | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Dev email form state
  const [devEmail, setDevEmail] = useState("");
  const [devPassword, setDevPassword] = useState("");
  const [devName, setDevName] = useState("");
  const [devMode, setDevMode] = useState<"login" | "register">("login");

  function log(msg: string) {
    setLogs((l) => [...l, { ts: Date.now(), msg }]);
  }


  const getEncryptionSession = useCallback(async (jwt: string): Promise<{ encryptionSession?: string; encryptionPart?: string }> => {
    try {
      const res = await fetch("/api/shield/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const data = (await res.json()) as { session_id?: string; encryption_part?: string };
        if (data.session_id) {
          log(`enc session: ${trunc(data.session_id)}`);
          return { encryptionSession: data.session_id };
        }
        if (data.encryption_part) {
          log("using encryptionPart fallback (DEMO ONLY)");
          return { encryptionPart: data.encryption_part };
        }
      }
    } catch {
      /* fall through */
    }
    log("shield session unavailable");
    return {};
  }, []);

  const checkWalletState = useCallback(async () => {
    if (!session?.user) return;
    log("checking wallet state...");
    try {
      const jwt = await getJwt();
      log(`JWT obtained: ${trunc(jwt)}`);

      const res = await fetch(`${HOT_URL}/v2/accounts`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });

      if (res.status === 404 || res.status === 204) {
        log("no wallet found");
        setState("noWallet");
        return;
      }

      if (!res.ok) {
        if (res.status === 401) {
          setState("signedOut");
          return;
        }
        setState("noWallet");
        return;
      }

      const data = (await res.json()) as unknown;
      // hot_storage returns { object: "list", data: [...] }
      const dataObj = data as Record<string, unknown>;
      const accounts: unknown[] = Array.isArray(dataObj["data"])
        ? (dataObj["data"] as unknown[])
        : Array.isArray(data)
          ? (data as unknown[])
          : [];

      if (accounts.length === 0) {
        log("no accounts");
        setState("noWallet");
        return;
      }

      log(`accounts raw: ${JSON.stringify(accounts[0]).slice(0, 150)}`);
      const account = accounts[0] as Record<string, unknown>;
      const accountId = (account["id"] ?? account["account_id"] ?? "") as string;
      const address = (account["address"] ?? account["account_address"] ?? "") as string;

      log(`account found: ${trunc(accountId)} address=${address}`);
      setExistingAccountId(accountId);
      setExistingAddress(address);

      if (!address) {
        setState("needsRecovery");
        return;
      }

      // Probe: sign a short message and verify against the known address.
      // If verification passes, the device share is present in IndexedDB.
      // If not (fresh context / new device), go to needsRecovery.
      log("probing device share...");
      try {
        const probeMsg = "opensigner-probe-" + accountId.slice(0, 8);
        const probeSig = await sign({ jwt, message: probeMsg });
        const probeRaw = probeSig as unknown as Record<string, unknown>;
        const probeSigValue = (probeRaw["signature"] ?? probeRaw["sig"] ?? "") as string;
        if (!probeSigValue) throw new Error("no signature returned");
        const probeOk = await verifySignature(address, probeMsg, probeSigValue as `0x${string}`);
        if (!probeOk) {
          log("probe: wrong key → needsRecovery");
          setState("needsRecovery");
          return;
        }
        log("probe: device share present");
      } catch (e) {
        log(`probe error: ${(e as Error).message} → needsRecovery`);
        setState("needsRecovery");
        return;
      }

      const bal = await getSepoliaBalance(address).catch(() => "0.000000");
      setWallet({ address, accountId, balance: bal });
      setState("ready");
      log(`wallet ready: ${address}`);
    } catch (err) {
      log(`wallet check error: ${(err as Error).message}`);
      setState("noWallet");
    }
  }, [session]);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) {
      setState("signedOut");
      return;
    }
    setState("busy");
    void checkWalletState();
  }, [session, isPending, checkWalletState]);

  async function handleCreate() {
    setState("busy");
    setError(null);
    try {
      const jwt = await getJwt();
      const encParams = await getEncryptionSession(jwt);
      log("calling iframe create...");
      const result = await create({
        jwt,
        userId: session!.user.id,
        ...encParams,
      });
      const raw = result as unknown as Record<string, unknown>;
      log(`create raw: ${JSON.stringify(raw).slice(0, 120)}`);
      const address = (raw["address"] ?? raw["account_address"] ?? "") as string;
      const accountId = (raw["accountId"] ?? raw["account_id"] ?? raw["account"] ?? raw["id"] ?? "") as string;
      log(`create: address=${address} accountId=${trunc(accountId)}`);
      const bal = await getSepoliaBalance(address).catch(() => "0.000000");
      setWallet({ address, accountId, balance: bal });
      setState("ready");
    } catch (err) {
      setError((err as Error).message);
      setState("noWallet");
      log(`create error: ${(err as Error).message}`);
    }
  }

  async function handleRecover() {
    if (!existingAccountId) return;
    setState("busy");
    setError(null);
    try {
      const jwt = await getJwt();
      const encParams = await getEncryptionSession(jwt);
      log("calling iframe recover...");
      const result = await recover({
        jwt,
        userId: session!.user.id,
        accountId: existingAccountId,
        ...encParams,
      });
      const raw = result as unknown as Record<string, unknown>;
      log(`recover raw: ${JSON.stringify(raw).slice(0, 120)}`);
      // Use address from recover result, fall back to the address discovered in checkWalletState
      const address = ((raw["address"] ?? raw["account_address"] ?? existingAddress ?? "") as string);
      log(`recover: address=${address}`);
      const bal = await getSepoliaBalance(address).catch(() => "0.000000");
      setWallet({ address, accountId: existingAccountId, balance: bal });
      setState("ready");
    } catch (err) {
      setError((err as Error).message);
      setState("needsRecovery");
      log(`recover error: ${(err as Error).message}`);
    }
  }

  async function handleSign() {
    if (!wallet) return;
    setError(null);
    setSigResult(null);
    setState("busy");
    try {
      const jwt = await getJwt();
      log(`signing message: "${message}"`);
      const result = await sign({ jwt, message });
      const raw = result as unknown as Record<string, unknown>;
      log(`sign raw: ${JSON.stringify(raw).slice(0, 80)}`);
      const sigValue = (raw["signature"] ?? raw["sig"] ?? "") as string;
      log(`signature: ${trunc(sigValue, 16)}`);
      const ok = await verifySignature(wallet.address, message, sigValue as Hex);
      setSigResult({ sig: sigValue, ok });
      log(`verify: ${ok ? "✓ signer matches" : "✗ mismatch"}`);
      setState("ready");
    } catch (err) {
      setError((err as Error).message);
      setState("ready");
      log(`sign error: ${(err as Error).message}`);
    }
  }

  async function handleLogout() {
    setState("busy");
    await disconnectIframe();
    await signOut();
    setWallet(null);
    setExistingAccountId(null);
    setSigResult(null);
    setState("signedOut");
    log("signed out");
  }

  async function refreshBalance() {
    if (!wallet) return;
    setBalanceLoading(true);
    const bal = await getSepoliaBalance(wallet.address).catch(() => wallet.balance);
    setWallet((w) => w ? { ...w, balance: bal } : w);
    setBalanceLoading(false);
  }

  function copyAddress() {
    if (!wallet) return;
    void navigator.clipboard.writeText(wallet.address);
    setCopiedAddress(true);
    setTimeout(() => setCopiedAddress(false), 1500);
  }

  async function handleDevAuth() {
    setError(null);
    try {
      if (devMode === "register") {
        await signUpEmail(devEmail, devPassword, devName || devEmail.split("@")[0]!);
      } else {
        await signInEmail(devEmail, devPassword);
      }
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (isPending) return null;

  return (
    <div className="fixed bottom-4 right-4 w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3">
        <h2 className="text-white font-semibold text-sm">Embedded Wallet</h2>
        <p className="text-blue-200 text-xs">Powered by OpenSigner</p>
      </div>

      <div className="p-4">
        {/* Error banner */}
        {error && (
          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs break-all">
            {error}
          </div>
        )}

        {/* signedOut */}
        {state === "signedOut" && (
          <div className="space-y-3">
            <button
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Continue with Google
            </button>

            {DEV_LOGIN && (
              <div className="border-t pt-3">
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={() => setDevMode("login")}
                    className={`text-xs px-2 py-1 rounded ${devMode === "login" ? "bg-blue-100 text-blue-700" : "text-gray-500"}`}
                  >
                    Login
                  </button>
                  <button
                    onClick={() => setDevMode("register")}
                    className={`text-xs px-2 py-1 rounded ${devMode === "register" ? "bg-blue-100 text-blue-700" : "text-gray-500"}`}
                  >
                    Register
                  </button>
                </div>
                <div className="space-y-2">
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    placeholder="Email"
                    value={devEmail}
                    onChange={(e) => setDevEmail(e.target.value)}
                  />
                  {devMode === "register" && (
                    <input
                      className="w-full border rounded px-2 py-1 text-xs"
                      placeholder="Name"
                      value={devName}
                      onChange={(e) => setDevName(e.target.value)}
                    />
                  )}
                  <input
                    className="w-full border rounded px-2 py-1 text-xs"
                    type="password"
                    placeholder="Password"
                    value={devPassword}
                    onChange={(e) => setDevPassword(e.target.value)}
                  />
                  <button
                    onClick={handleDevAuth}
                    className="w-full bg-blue-600 text-white py-1 rounded text-xs"
                  >
                    {devMode === "login" ? "Sign in" : "Create account"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* busy */}
        {state === "busy" && (
          <div className="flex items-center justify-center py-8 gap-2 text-gray-400 text-sm">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Working…
          </div>
        )}

        {/* noWallet */}
        {state === "noWallet" && (
          <div className="space-y-3">
            <div className="text-sm text-gray-600">
              <p className="font-medium">Hello, {session?.user.name ?? session?.user.email}</p>
              <p className="text-xs text-gray-400 mt-1">No wallet found. Create one to get started.</p>
            </div>
            <button
              onClick={handleCreate}
              className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700"
            >
              Create wallet
            </button>
            <p className="text-xs text-gray-400">Key is split across device, hot, and cold storage. Recovery is automatic.</p>
          </div>
        )}

        {/* needsRecovery */}
        {state === "needsRecovery" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Device share not found on this device.</p>
            <button
              onClick={handleRecover}
              className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
            >
              Recover wallet on this device
            </button>
          </div>
        )}

        {/* ready */}
        {state === "ready" && wallet && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-400">{session?.user.email}</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-xs font-mono text-gray-700" data-testid="wallet-address">
                    {wallet.address.slice(0, 10)}…{wallet.address.slice(-6)}
                  </span>
                  <button onClick={copyAddress} className="text-gray-400 hover:text-blue-600" title="Copy address">
                    {copiedAddress ? (
                      <svg className="w-3 h-3 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                  <a
                    href={`https://sepolia.etherscan.io/address/${wallet.address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-blue-600"
                    title="View on Etherscan"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-1">
                  <p className="text-sm font-medium">{wallet.balance} ETH</p>
                  <button
                    onClick={refreshBalance}
                    className={`text-gray-400 hover:text-blue-600 ${balanceLoading ? "animate-spin" : ""}`}
                    disabled={balanceLoading}
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                </div>
                <a
                  href="https://www.alchemy.com/faucets/ethereum-sepolia"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-500 hover:underline"
                >
                  Get test ETH
                </a>
              </div>
            </div>

            {/* Sign */}
            <div className="border-t pt-3 space-y-2">
              <input
                className="w-full border rounded px-2 py-1 text-xs"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Message to sign"
              />
              <button
                onClick={handleSign}
                className="w-full bg-indigo-600 text-white py-1.5 rounded text-xs font-medium hover:bg-indigo-700"
              >
                Sign message
              </button>
              {sigResult && (
                <div className={`p-2 rounded text-xs ${sigResult.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
                  {sigResult.ok ? "✓ Verified: signer = wallet address" : "✗ Signature mismatch"}
                  <div className="mt-1 font-mono text-gray-500 break-all text-xs">
                    {sigResult.sig.slice(0, 20)}…
                  </div>
                </div>
              )}
            </div>


            <button
              onClick={handleLogout}
              className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
            >
              Log out
            </button>
          </div>
        )}

        <ActivityLog entries={logs} />
      </div>
    </div>
  );
}
