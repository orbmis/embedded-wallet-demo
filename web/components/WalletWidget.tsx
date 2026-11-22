"use client";
import { useState, useEffect, useCallback } from "react";
import { authClient, signInWithGoogle, signUpEmail, signInEmail, signOut, getJwt } from "@/lib/auth";
import { create, sign, signRaw, recover } from "@/lib/signer";
import { getSepoliaBalance, verifySignature } from "@/lib/chain";
import { walletProvider, type PendingRequest } from "@/lib/provider";
import { formatEther, parseEther, type Hex } from "viem";
import ActivityLog, { type LogEntry } from "./ActivityLog";

type WalletState = "signedOut" | "noWallet" | "needsRecovery" | "ready" | "busy";

const DEV_LOGIN = process.env["NEXT_PUBLIC_DEV_EMAIL_LOGIN"] === "true";
const HOT_URL = process.env["NEXT_PUBLIC_HOT_STORAGE_URL"] ?? "http://localhost:7054";

function trunc(s: string | null | undefined, n = 8) {
  if (!s) return "(empty)";
  return s.slice(0, n) + "…";
}

export default function WalletWidget() {
  const { data: session, isPending } = authClient.useSession();

  const [state, setState] = useState<WalletState>("busy");
  const [address, setAddress] = useState("");
  const [accountId, setAccountId] = useState("");
  const [existingAddress, setExistingAddress] = useState("");
  const [existingAccountId, setExistingAccountId] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [approving, setApproving] = useState(false);

  // Dev login form
  const [devEmail, setDevEmail] = useState("");
  const [devPassword, setDevPassword] = useState("");
  const [devName, setDevName] = useState("");
  const [devMode, setDevMode] = useState<"login" | "register">("login");

  function log(msg: string) {
    setLogs(l => [...l, { ts: Date.now(), msg }]);
  }

  // Wire up pending request handler
  useEffect(() => {
    walletProvider.onPendingRequest = req => setPending(req);
    return () => { walletProvider.onPendingRequest = null; };
  }, []);

  // Sync account into provider whenever wallet is ready/cleared
  useEffect(() => {
    walletProvider.setAccount(state === "ready" ? address : null);
  }, [state, address]);

  const getEncryptionParams = useCallback(async (jwt: string) => {
    try {
      const res = await fetch("/api/shield/session", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (res.ok) {
        const d = (await res.json()) as { session_id?: string; encryption_part?: string };
        if (d.session_id) { log(`enc session: ${trunc(d.session_id)}`); return { encryptionSession: d.session_id }; }
        if (d.encryption_part) { log("enc part fallback"); return { encryptionPart: d.encryption_part }; }
      }
    } catch { /* fall through */ }
    return {};
  }, []);

  const checkWalletState = useCallback(async () => {
    if (!session?.user) return;
    log("checking wallet state…");
    try {
      const jwt = await getJwt();
      const res = await fetch(`${HOT_URL}/v2/accounts`, { headers: { Authorization: `Bearer ${jwt}` } });
      if (!res.ok) { setState(res.status === 401 ? "signedOut" : "noWallet"); return; }
      const data = (await res.json()) as Record<string, unknown>;
      const accounts = (Array.isArray(data["data"]) ? data["data"] : []) as Record<string, unknown>[];
      if (accounts.length === 0) { setState("noWallet"); return; }
      const acc = accounts[0]!;
      const id = (acc["id"] ?? acc["account_id"] ?? "") as string;
      const addr = (acc["address"] ?? acc["account_address"] ?? "") as string;
      log(`account: ${trunc(id)} addr=${addr}`);
      setExistingAccountId(id);
      setExistingAddress(addr);
      if (!addr) { setState("needsRecovery"); return; }
      setAddress(addr);
      setAccountId(id);
      setState("ready");
      log("wallet ready");
    } catch (e) {
      log(`check error: ${(e as Error).message}`);
      setState("noWallet");
    }
  }, [session]);

  useEffect(() => {
    if (isPending) return;
    if (!session?.user) { setState("signedOut"); return; }
    setState("busy");
    void checkWalletState();
  }, [session, isPending, checkWalletState]);

  async function handleCreate() {
    setState("busy");
    setError(null);
    try {
      const jwt = await getJwt();
      const enc = await getEncryptionParams(jwt);
      const result = await create({ jwt, userId: session!.user.id, ...enc });
      const raw = result as unknown as Record<string, unknown>;
      log(`create: ${JSON.stringify(raw).slice(0, 100)}`);
      const addr = (raw["address"] ?? raw["account_address"] ?? "") as string;
      const id = (raw["accountId"] ?? raw["account_id"] ?? raw["account"] ?? raw["id"] ?? "") as string;
      setAddress(addr);
      setAccountId(id);
      setState("ready");
    } catch (e) {
      setError((e as Error).message);
      setState("noWallet");
    }
  }

  async function handleRecover() {
    if (!existingAccountId) return;
    setState("busy");
    setError(null);
    try {
      const jwt = await getJwt();
      const enc = await getEncryptionParams(jwt);
      const result = await recover({ jwt, userId: session!.user.id, accountId: existingAccountId, ...enc });
      const raw = result as unknown as Record<string, unknown>;
      const addr = (raw["address"] ?? raw["account_address"] ?? existingAddress ?? "") as string;
      setAddress(addr);
      setAccountId(existingAccountId);
      setState("ready");
    } catch (e) {
      setError((e as Error).message);
      setState("needsRecovery");
    }
  }

  async function handleLogout() {
    await signOut();
    setAddress("");
    setAccountId("");
    setState("signedOut");
  }

  // ── Approval handlers ───────────────────────────────────────────────────
  async function approveConnection() {
    if (!pending || pending.method !== "eth_requestAccounts") return;
    setApproving(true);
    walletProvider.approvePending([address]);
    setApproving(false);
  }

  async function approveSign() {
    if (!pending || pending.method !== "personal_sign") return;
    setApproving(true);
    setError(null);
    try {
      const params = pending.params as string[];
      const isAddrFirst = params[0]?.startsWith("0x") && params[0]?.length === 42;
      const msgHex = isAddrFirst ? params[1] : params[0];
      const jwt = await getJwt();
      let sig = "";

      // 32-byte hex (66 chars) = ERC-4337 userOpHash — sign the raw bytes so
      // SimpleAccount's toEthSignedMessageHash().recover() gets the right signer.
      if (msgHex?.startsWith("0x") && msgHex.length === 66) {
        const result = await signRaw({ jwt, messageHex: msgHex as Hex });
        const raw = result as unknown as Record<string, unknown>;
        sig = (raw["signature"] ?? raw["sig"] ?? "") as string;
        log(`signRaw (userOpHash): ${trunc(sig, 16)}`);
      } else {
        const msgStr = msgHex?.startsWith("0x")
          ? new TextDecoder().decode(Buffer.from(msgHex.slice(2), "hex"))
          : (msgHex ?? "");
        const result = await sign({ jwt, message: msgStr });
        const raw = result as unknown as Record<string, unknown>;
        sig = (raw["signature"] ?? raw["sig"] ?? "") as string;
        log(`personal_sign: ${trunc(sig, 16)}`);
      }

      walletProvider.approvePending(sig);
    } catch (e) {
      setError((e as Error).message);
      walletProvider.rejectPending();
    } finally {
      setApproving(false);
    }
  }

  async function approveSend() {
    if (!pending || pending.method !== "eth_sendTransaction") return;
    setApproving(true);
    setError(null);
    try {
      const tx = (pending.params as Record<string, string>[])[0]!;
      const valueWei = BigInt(tx["value"] ?? "0x0");
      const jwt = await getJwt();
      // Sign a human-readable representation with personal_sign (EIP-191 — works)
      const signableMsg = `Send ${formatEther(valueWei)} ETH to ${tx["to"]} on Sepolia (chainId 11155111)`;
      const result = await sign({ jwt, message: signableMsg });
      const raw = result as unknown as Record<string, unknown>;
      const sig = (raw["signature"] ?? raw["sig"] ?? "") as string;
      log(`eth_sendTransaction signed: ${trunc(sig, 16)}`);
      // Verify sig recovers to our address
      const ok = await verifySignature(address, signableMsg, sig as Hex);
      log(`verify: ${ok ? "✓" : "✗"}`);
      // Return signature — dApp knows raw broadcast isn't available
      walletProvider.approvePending(sig);
    } catch (e) {
      setError((e as Error).message);
      walletProvider.rejectPending();
    } finally {
      setApproving(false);
    }
  }

  if (isPending) return null;

  const isUserOpSign =
    pending?.method === "personal_sign" &&
    typeof (pending.params as string[])[0] === "string" &&
    ((pending.params as string[])[0]?.length === 66 ||
      (pending.params as string[])[1]?.length === 66);

  const pendingLabel = pending
    ? pending.method === "eth_requestAccounts" ? "Connection request"
    : isUserOpSign ? "Authorize transaction"
    : pending.method === "personal_sign" ? "Sign message"
    : "Send transaction"
    : null;

  return (
    <div className="w-80 bg-white rounded-2xl shadow-xl border border-gray-100 flex flex-col max-h-screen overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-3 rounded-t-2xl shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-white font-semibold text-sm">OpenSigner Wallet</h2>
            <p className="text-indigo-200 text-xs">
              {state === "ready" ? `${address.slice(0, 8)}…${address.slice(-4)}` : "Not connected"}
            </p>
          </div>
          {state === "ready" && (
            <div className="w-2 h-2 rounded-full bg-green-400" title="Connected" />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* ── Pending approval overlay ───────────────────────────────── */}
        {pending && (
          <div className="border-2 border-indigo-200 rounded-xl p-3 bg-indigo-50 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-indigo-700 uppercase tracking-wide">{pendingLabel}</span>
            </div>

            {pending.method === "eth_requestAccounts" && (
              <div className="text-xs text-gray-700 space-y-1">
                <p>The dApp is requesting access to your wallet.</p>
                <p className="font-mono bg-white rounded p-1.5 border text-xs">{address}</p>
              </div>
            )}

            {pending.method === "personal_sign" && (() => {
              const params = pending.params as string[];
              const isAddrFirst = params[0]?.startsWith("0x") && params[0]?.length === 42;
              const msgHex = isAddrFirst ? params[1] : params[0];
              const msg = msgHex?.startsWith("0x")
                ? new TextDecoder().decode(Buffer.from(msgHex.slice(2), "hex"))
                : (msgHex ?? "");
              return (
                <div className="text-xs text-gray-700 space-y-1">
                  <p className="text-gray-500">Message:</p>
                  <p className="font-mono bg-white rounded p-1.5 border break-all">{msg}</p>
                </div>
              );
            })()}

            {pending.method === "eth_sendTransaction" && (() => {
              const tx = (pending.params as Record<string, string>[])[0]!;
              const valueWei = BigInt(tx["value"] ?? "0x0");
              return (
                <div className="text-xs text-gray-700 space-y-1">
                  <div className="bg-white rounded p-2 border space-y-1">
                    <p><span className="text-gray-400">To:</span> <span className="font-mono">{tx["to"]?.slice(0, 10)}…</span></p>
                    <p><span className="text-gray-400">Value:</span> {formatEther(valueWei)} ETH</p>
                    <p><span className="text-gray-400">Network:</span> Sepolia</p>
                  </div>
                </div>
              );
            })()}

            {error && (
              <p className="text-xs text-red-600 bg-red-50 rounded p-1.5">{error}</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={walletProvider.rejectPending.bind(walletProvider)}
                disabled={approving}
                className="flex-1 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50"
              >
                Reject
              </button>
              <button
                onClick={
                  pending.method === "eth_requestAccounts" ? approveConnection
                  : pending.method === "personal_sign" ? approveSign
                  : approveSend
                }
                disabled={approving}
                className="flex-1 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {approving ? "Signing…" : "Approve"}
              </button>
            </div>
          </div>
        )}

        {/* ── Wallet state ───────────────────────────────────────────── */}
        {!pending && (
          <>
            {error && (
              <div className="p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">{error}</div>
            )}

            {state === "signedOut" && (
              <div className="space-y-3">
                <button
                  onClick={signInWithGoogle}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium"
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
                  <div className="border-t pt-3 space-y-2">
                    <div className="flex gap-1">
                      {(["login", "register"] as const).map(m => (
                        <button key={m} onClick={() => setDevMode(m)}
                          className={`flex-1 text-xs py-1 rounded ${devMode === m ? "bg-indigo-100 text-indigo-700" : "text-gray-500"}`}>
                          {m === "login" ? "Login" : "Register"}
                        </button>
                      ))}
                    </div>
                    <input className="w-full border rounded px-2 py-1 text-xs" placeholder="Email" value={devEmail} onChange={e => setDevEmail(e.target.value)} />
                    {devMode === "register" && <input className="w-full border rounded px-2 py-1 text-xs" placeholder="Name" value={devName} onChange={e => setDevName(e.target.value)} />}
                    <input type="password" className="w-full border rounded px-2 py-1 text-xs" placeholder="Password" value={devPassword} onChange={e => setDevPassword(e.target.value)} />
                    <button
                      onClick={async () => {
                        setError(null);
                        try {
                          devMode === "register"
                            ? await signUpEmail(devEmail, devPassword, devName || devEmail.split("@")[0]!)
                            : await signInEmail(devEmail, devPassword);
                        } catch (e) { setError((e as Error).message); }
                      }}
                      className="w-full bg-indigo-600 text-white py-1.5 rounded text-xs"
                    >
                      {devMode === "login" ? "Sign in" : "Create account"}
                    </button>
                  </div>
                )}
              </div>
            )}

            {state === "busy" && (
              <div className="flex items-center justify-center py-6 gap-2 text-gray-400 text-sm">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Working…
              </div>
            )}

            {state === "noWallet" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Signed in as <span className="font-medium">{session?.user.email}</span></p>
                <button onClick={handleCreate} className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
                  Create wallet
                </button>
                <p className="text-xs text-gray-400">Key split across device, hot &amp; cold storage.</p>
              </div>
            )}

            {state === "needsRecovery" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Device share not found.</p>
                <button onClick={handleRecover} className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">
                  Recover wallet
                </button>
              </div>
            )}

            {state === "ready" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Ready to sign — connect from the dApp</p>
                <button onClick={handleLogout} className="w-full text-xs text-gray-400 hover:text-gray-600 py-1">
                  Log out
                </button>
              </div>
            )}
          </>
        )}

        <ActivityLog entries={logs} />
      </div>
    </div>
  );
}
