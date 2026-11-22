"use client";
import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { authClient, signInWithGoogle, signUpEmail, signInEmail, signOut, getJwt } from "@/lib/auth";
import { create, sign, signRaw, recover } from "@/lib/signer";
import { verifySignature } from "@/lib/chain";
import { walletProvider, PROVIDER_INFO, type PendingRequest } from "@/lib/provider";
import { formatEther, type Hex } from "viem";
import ActivityLog, { type LogEntry } from "./ActivityLog";

type WalletState = "signedOut" | "noWallet" | "needsRecovery" | "ready" | "busy";

const DEV_LOGIN = process.env["NEXT_PUBLIC_DEV_EMAIL_LOGIN"] === "true";
const HOT_URL   = process.env["NEXT_PUBLIC_HOT_STORAGE_URL"] ?? "http://localhost:7054";

function trunc(s: string | null | undefined, n = 8) {
  if (!s) return "(empty)";
  return s.slice(0, n) + "…";
}

// ── Approval modal portal ───────────────────────────────────────────────────
function ApprovalModal({
  pending, approving, error,
  onApprove, onReject,
}: {
  pending: PendingRequest;
  approving: boolean;
  error: string | null;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isUserOpSign =
    pending.method === "personal_sign" &&
    ((pending.params as string[])[0]?.length === 66 ||
     (pending.params as string[])[1]?.length === 66);

  const title =
    pending.method === "eth_requestAccounts" ? "Connection Request"
    : isUserOpSign                           ? "Authorize Transaction"
    : pending.method === "personal_sign"     ? "Sign Message"
    : "Send Transaction";

  const params = pending.params as string[];
  const isAddrFirst = params[0]?.startsWith("0x") && params[0]?.length === 42;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 sm:p-0">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onReject} />

      {/* Card */}
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl animate-slide-up sm:animate-fade-in overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-5 py-4">
          <div className="flex items-center gap-3">
            <img src={PROVIDER_INFO.icon} alt="" className="w-9 h-9 rounded-xl bg-white/20 p-1" />
            <div>
              <p className="text-xs text-indigo-200">{PROVIDER_INFO.name}</p>
              <p className="text-white font-semibold">{title}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {pending.method === "eth_requestAccounts" && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">This dApp is requesting access to your wallet.</p>
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                <p className="text-xs text-slate-500 mb-1">Address</p>
                <p className="font-mono text-sm text-slate-800 break-all">
                  {walletProvider.accounts[0] ?? "—"}
                </p>
              </div>
            </div>
          )}

          {pending.method === "personal_sign" && !isUserOpSign && (() => {
            const msgHex = isAddrFirst ? params[1] : params[0];
            const msg = msgHex?.startsWith("0x")
              ? new TextDecoder().decode(Buffer.from(msgHex.slice(2), "hex"))
              : (msgHex ?? "");
            return (
              <div className="space-y-2">
                <p className="text-xs text-slate-500 font-medium">Message to sign</p>
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 max-h-32 overflow-y-auto">
                  <p className="text-sm text-slate-700 break-all">{msg}</p>
                </div>
              </div>
            );
          })()}

          {isUserOpSign && (
            <div className="space-y-2">
              <p className="text-sm text-slate-600">Your wallet is authorizing a transaction you initiated in the dApp.</p>
              <div className="flex items-center gap-2 bg-indigo-50 rounded-xl p-3 border border-indigo-100">
                <svg className="w-4 h-4 text-indigo-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <p className="text-xs text-indigo-700">Gas is sponsored by Pimlico — no ETH needed</p>
              </div>
            </div>
          )}

          {pending.method === "eth_sendTransaction" && (() => {
            const tx = (pending.params as Record<string, string>[])[0]!;
            const valueWei = BigInt(tx["value"] ?? "0x0");
            return (
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">To</span>
                  <span className="font-mono text-slate-800">{tx["to"]?.slice(0, 10)}…</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Amount</span>
                  <span className="font-semibold text-slate-800">{formatEther(valueWei)} ETH</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Network</span>
                  <span className="text-slate-800">Sepolia</span>
                </div>
              </div>
            );
          })()}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg p-2.5 border border-red-100">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="px-5 pb-5 flex gap-3">
          <button onClick={onReject} disabled={approving}
            className="flex-1 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50">
            Reject
          </button>
          <button onClick={onApprove} disabled={approving}
            className="flex-1 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 shadow-sm shadow-indigo-200">
            {approving ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                </svg>
                Signing…
              </span>
            ) : "Approve"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Main widget ─────────────────────────────────────────────────────────────
export default function WalletWidget() {
  const { data: session, isPending } = authClient.useSession();

  const [state,            setState]           = useState<WalletState>("busy");
  const [address,          setAddress]         = useState("");
  const [existingAccountId, setExistingAccountId] = useState("");
  const [existingAddress,  setExistingAddress] = useState("");
  const [logs,             setLogs]            = useState<LogEntry[]>([]);
  const [error,            setError]           = useState<string | null>(null);
  const [pending,          setPending]         = useState<PendingRequest | null>(null);
  const [approving,        setApproving]       = useState(false);
  const [mounted,          setMounted]         = useState(false);

  const [devEmail,    setDevEmail]    = useState("");
  const [devPassword, setDevPassword] = useState("");
  const [devName,     setDevName]     = useState("");
  const [devMode,     setDevMode]     = useState<"login" | "register">("login");

  useEffect(() => { setMounted(true); }, []);

  function log(msg: string) {
    setLogs(l => [...l, { ts: Date.now(), msg }]);
  }

  useEffect(() => {
    walletProvider.onPendingRequest = req => setPending(req);
    return () => { walletProvider.onPendingRequest = null; };
  }, []);

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
        if (d.session_id)       { log(`enc session: ${trunc(d.session_id)}`);  return { encryptionSession: d.session_id }; }
        if (d.encryption_part)  { log("enc part fallback");                    return { encryptionPart: d.encryption_part }; }
      }
    } catch { /* fall through */ }
    return {};
  }, []);

  const checkWalletState = useCallback(async () => {
    if (!session?.user) return;
    log("checking wallet…");
    try {
      const jwt = await getJwt();
      const res = await fetch(`${HOT_URL}/v2/accounts`, { headers: { Authorization: `Bearer ${jwt}` } });
      if (!res.ok) { setState(res.status === 401 ? "signedOut" : "noWallet"); return; }
      const data = (await res.json()) as Record<string, unknown>;
      const accounts = (Array.isArray(data["data"]) ? data["data"] : []) as Record<string, unknown>[];
      if (accounts.length === 0) { setState("noWallet"); return; }
      const acc  = accounts[0]!;
      const id   = (acc["id"] ?? acc["account_id"] ?? "") as string;
      const addr = (acc["address"] ?? acc["account_address"] ?? "") as string;
      log(`account: ${trunc(id)}`);
      setExistingAccountId(id);
      setExistingAddress(addr);
      if (!addr) { setState("needsRecovery"); return; }
      setAddress(addr);
      setState("ready");
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
    setState("busy"); setError(null);
    try {
      const jwt = await getJwt();
      const enc = await getEncryptionParams(jwt);
      const result = await create({ jwt, userId: session!.user.id, ...enc });
      const raw  = result as unknown as Record<string, unknown>;
      const addr = (raw["address"] ?? raw["account_address"] ?? "") as string;
      setAddress(addr);
      setState("ready");
    } catch (e) { setError((e as Error).message); setState("noWallet"); }
  }

  async function handleRecover() {
    if (!existingAccountId) return;
    setState("busy"); setError(null);
    try {
      const jwt = await getJwt();
      const enc = await getEncryptionParams(jwt);
      const result = await recover({ jwt, userId: session!.user.id, accountId: existingAccountId, ...enc });
      const raw  = result as unknown as Record<string, unknown>;
      const addr = (raw["address"] ?? raw["account_address"] ?? existingAddress ?? "") as string;
      setAddress(addr);
      setState("ready");
    } catch (e) { setError((e as Error).message); setState("needsRecovery"); }
  }

  async function handleLogout() {
    await signOut();
    setAddress(""); setState("signedOut");
  }

  // ── Approvals ───────────────────────────────────────────────────────────────
  async function approveConnection() {
    if (!pending || pending.method !== "eth_requestAccounts") return;
    setApproving(true);
    walletProvider.approvePending([address]);
    setApproving(false);
  }

  async function approveSign() {
    if (!pending || pending.method !== "personal_sign") return;
    setApproving(true); setError(null);
    try {
      const params = pending.params as string[];
      const isAddrFirst = params[0]?.startsWith("0x") && params[0]?.length === 42;
      const msgHex = isAddrFirst ? params[1] : params[0];
      const jwt = await getJwt();
      let sig = "";
      if (msgHex?.startsWith("0x") && msgHex.length === 66) {
        const result = await signRaw({ jwt, messageHex: msgHex as Hex });
        const raw = result as unknown as Record<string, unknown>;
        sig = (raw["signature"] ?? raw["sig"] ?? "") as string;
      } else {
        const msgStr = msgHex?.startsWith("0x")
          ? new TextDecoder().decode(Buffer.from(msgHex.slice(2), "hex"))
          : (msgHex ?? "");
        const result = await sign({ jwt, message: msgStr });
        const raw = result as unknown as Record<string, unknown>;
        sig = (raw["signature"] ?? raw["sig"] ?? "") as string;
      }
      log(`signed: ${trunc(sig, 16)}`);
      walletProvider.approvePending(sig);
    } catch (e) {
      setError((e as Error).message);
      walletProvider.rejectPending();
    } finally { setApproving(false); }
  }

  async function approveSend() {
    if (!pending || pending.method !== "eth_sendTransaction") return;
    setApproving(true); setError(null);
    try {
      const tx = (pending.params as Record<string, string>[])[0]!;
      const valueWei = BigInt(tx["value"] ?? "0x0");
      const jwt = await getJwt();
      const signableMsg = `Send ${formatEther(valueWei)} ETH to ${tx["to"]} on Sepolia`;
      const result = await sign({ jwt, message: signableMsg });
      const raw = result as unknown as Record<string, unknown>;
      const sig = (raw["signature"] ?? raw["sig"] ?? "") as string;
      const ok = await verifySignature(address, signableMsg, sig as Hex);
      log(`eth_sendTransaction signed: ${ok ? "✓" : "✗"}`);
      walletProvider.approvePending(sig);
    } catch (e) {
      setError((e as Error).message);
      walletProvider.rejectPending();
    } finally { setApproving(false); }
  }

  function handleApprove() {
    if (!pending) return;
    if (pending.method === "eth_requestAccounts") void approveConnection();
    else if (pending.method === "personal_sign")   void approveSign();
    else                                           void approveSend();
  }

  if (isPending) return null;

  const statusColor =
    state === "ready"    ? "bg-emerald-400"
    : state === "busy"   ? "bg-amber-400 animate-pulse-dot"
    : state === "signedOut" ? "bg-slate-300"
    : "bg-amber-400 animate-pulse-dot";

  return (
    <>
      {/* Approval modal — rendered to body via portal */}
      {mounted && pending && (
        <ApprovalModal
          pending={pending}
          approving={approving}
          error={error}
          onApprove={handleApprove}
          onReject={() => { walletProvider.rejectPending(); setError(null); }}
        />
      )}

      {/* Wallet panel */}
      <div className="w-72 bg-white rounded-2xl shadow-lg border border-slate-100 flex flex-col max-h-[calc(100vh-5rem)] overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-3.5 rounded-t-2xl shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src={PROVIDER_INFO.icon} alt="" className="w-7 h-7 rounded-lg bg-white/20 p-0.5" />
              <div>
                <p className="text-white font-semibold text-sm leading-tight">OpenSigner</p>
                <p className="text-indigo-200 text-xs leading-tight">
                  {state === "ready"
                    ? `${address.slice(0, 8)}…${address.slice(-4)}`
                    : "Not connected"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${statusColor}`} />
              <span className="text-indigo-200 text-xs capitalize">{state}</span>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {error && !pending && (
            <div className="p-2.5 bg-red-50 border border-red-100 rounded-xl text-red-600 text-xs">{error}</div>
          )}

          {state === "signedOut" && (
            <div className="space-y-3">
              <button onClick={signInWithGoogle}
                className="w-full flex items-center justify-center gap-2.5 py-2.5 px-3 border border-slate-200 rounded-xl hover:bg-slate-50 text-sm font-medium transition-colors">
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </button>

              {DEV_LOGIN && (
                <div className="border-t border-slate-100 pt-3 space-y-2">
                  <div className="flex gap-1 p-0.5 bg-slate-100 rounded-lg">
                    {(["login", "register"] as const).map(m => (
                      <button key={m} onClick={() => setDevMode(m)}
                        className={`flex-1 text-xs py-1 rounded-md font-medium transition-all capitalize
                          ${devMode === m ? "bg-white text-slate-800 shadow-sm" : "text-slate-500"}`}>
                        {m === "login" ? "Login" : "Register"}
                      </button>
                    ))}
                  </div>
                  <input className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Email" value={devEmail} onChange={e => setDevEmail(e.target.value)} />
                  {devMode === "register" && (
                    <input className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Name" value={devName} onChange={e => setDevName(e.target.value)} />
                  )}
                  <input type="password" className="w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300" placeholder="Password" value={devPassword} onChange={e => setDevPassword(e.target.value)} />
                  <button
                    onClick={async () => {
                      setError(null);
                      try {
                        devMode === "register"
                          ? await signUpEmail(devEmail, devPassword, devName || devEmail.split("@")[0]!)
                          : await signInEmail(devEmail, devPassword);
                      } catch (e) { setError((e as Error).message); }
                    }}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2 rounded-lg text-xs font-semibold">
                    {devMode === "login" ? "Sign in" : "Create account"}
                  </button>
                </div>
              )}
            </div>
          )}

          {state === "busy" && (
            <div className="flex items-center justify-center py-8 gap-2 text-slate-400 text-sm">
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Working…
            </div>
          )}

          {state === "noWallet" && (
            <div className="space-y-3">
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                <p className="text-xs font-medium text-slate-700">{session?.user.email}</p>
                <p className="text-xs text-slate-400 mt-0.5">No wallet yet</p>
              </div>
              <button onClick={handleCreate}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity shadow-sm shadow-indigo-200">
                Create wallet
              </button>
              <p className="text-xs text-slate-400 text-center">Key split across device, hot &amp; cold storage</p>
            </div>
          )}

          {state === "needsRecovery" && (
            <div className="space-y-3">
              <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 flex gap-2">
                <svg className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                </svg>
                <p className="text-xs text-amber-800">Device share not found on this device.</p>
              </div>
              <button onClick={handleRecover}
                className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:opacity-90 transition-opacity">
                Recover wallet
              </button>
            </div>
          )}

          {state === "ready" && (
            <div className="space-y-3">
              <div className="bg-emerald-50 rounded-xl p-3 border border-emerald-100 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse-dot shrink-0" />
                <p className="text-xs text-emerald-700 font-medium">Ready to sign</p>
              </div>
              <p className="text-xs text-slate-500 text-center">Connect from the dApp to get started</p>
              <button onClick={handleLogout}
                className="w-full text-xs text-slate-400 hover:text-slate-600 py-1.5 transition-colors">
                Log out
              </button>
            </div>
          )}

          <ActivityLog entries={logs} />
        </div>
      </div>
    </>
  );
}
