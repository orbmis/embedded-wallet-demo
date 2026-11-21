"use client";
import { connect, WindowMessenger } from "penpal";

const IFRAME_URL =
  process.env["NEXT_PUBLIC_IFRAME_URL"] ??
  "http://localhost:7050/index.html?debug=true";
const HOT_STORAGE_URL =
  process.env["NEXT_PUBLIC_HOT_STORAGE_URL"] ?? "http://localhost:7054";
const COLD_STORAGE_URL =
  process.env["NEXT_PUBLIC_COLD_STORAGE_URL"] ?? "http://localhost:7053";
const SHIELD_API_KEY = process.env["NEXT_PUBLIC_SHIELD_API_KEY"] ?? "";

export interface CreateResult {
  address: string;
  accountId: string;
}

export interface SignResult {
  signature: string;
}

export interface RecoverResult {
  address: string;
}

type IframeMethods = {
  create(req: unknown): Promise<CreateResult>;
  sign(req: unknown): Promise<SignResult>;
  recover(req: unknown): Promise<RecoverResult>;
  logout(req: unknown): Promise<void>;
  getCurrentDevice(req: unknown): Promise<unknown>;
  updateAuthentication(req: unknown): Promise<unknown>;
  export(req: unknown): Promise<unknown>;
  setRecoveryMethod(req: unknown): Promise<unknown>;
};

let _iframe: HTMLIFrameElement | null = null;
let _connection: IframeMethods | null = null;

function getOrCreateIframe(): HTMLIFrameElement {
  if (_iframe) return _iframe;
  const el = document.createElement("iframe");
  el.id = "opensigner-worker";
  el.src = IFRAME_URL;
  el.style.display = "none";
  document.body.appendChild(el);
  _iframe = el;
  return el;
}

async function getConnection(): Promise<IframeMethods> {
  if (_connection) return _connection;
  const iframe = getOrCreateIframe();
  const messenger = new WindowMessenger({
    remoteWindow: iframe.contentWindow!,
    allowedOrigins: ["http://localhost:7050"],
  });
  const conn = connect<IframeMethods>({
    messenger,
    timeout: 10000,
    methods: {
      sign: async () => { /* host-side stub — iframe calls this for outbound signing if needed */ },
      updateAuthentication: async () => {},
      logout: async () => {},
      export: async () => {},
      setRecoveryMethod: async () => {},
      getCurrentDevice: async () => {},
    },
  });
  _connection = await conn.promise;
  return _connection;
}

function uuid(): string {
  return crypto.randomUUID();
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`iframe call timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export async function create(params: {
  jwt: string;
  userId: string;
  /** Either encryptionSession (preferred, server-issued) or encryptionPart (DEMO ONLY) */
  encryptionSession?: string;
  encryptionPart?: string;
  chainId?: number;
}): Promise<CreateResult> {
  const remote = await getConnection();
  const encSession = params.encryptionSession ?? null;
  const encPart = encSession ? null : (params.encryptionPart ?? null);
  const result = await withTimeout(
    remote.create({
      uuid: uuid(),
      accountType: "Smart Account",
      chainType: "EVM",
      chainId: params.chainId ?? 11155111,
      publishableKey: params.jwt,
      accessToken: params.jwt,
      userEntropy: "TODO",
      projectEntropy: "TODO",
      playerID: params.userId,
      thirdPartyProvider: null,
      thirdPartyTokenType: "jwt",
      encryptionKey: null,
      encryptionPart: encPart,
      encryptionSession: encSession,
      openfortURL: HOT_STORAGE_URL,
      shieldURL: COLD_STORAGE_URL,
      shieldAPIKey: SHIELD_API_KEY,
      recovery: {
        auth: "custom",
        token: params.jwt,
        authProvider: "authservice",
        tokenType: "jwt",
        encryptionSession: encSession,
      },
    }),
    30000,
  );
  return result;
}

export async function sign(params: {
  jwt: string;
  message: string;
}): Promise<SignResult> {
  const remote = await getConnection();
  const encoded = new TextEncoder().encode(params.message);
  const result = await withTimeout(
    remote.sign({
      uuid: uuid(),
      message: encoded,
      requestConfiguration: {
        token: params.jwt,
        thirdPartyProvider: null,
        thirdPartyTokenType: "jwt",
        publishableKey: params.jwt,
        openfortURL: HOT_STORAGE_URL,
      },
    }),
    30000,
  );
  return result;
}

export async function recover(params: {
  jwt: string;
  userId: string;
  accountId: string;
  encryptionSession?: string;
  encryptionPart?: string;
}): Promise<RecoverResult> {
  const remote = await getConnection();
  const encSession = params.encryptionSession ?? null;
  const encPart = encSession ? null : (params.encryptionPart ?? null);
  const result = await withTimeout(
    remote.recover({
      uuid: uuid(),
      recovery: {
        auth: "custom",
        token: params.jwt,
        authProvider: "authservice",
        tokenType: "jwt",
        encryptionSession: encSession,
      },
      publishableKey: params.jwt,
      shieldAPIKey: SHIELD_API_KEY,
      accessToken: params.jwt,
      playerID: params.userId,
      account: params.accountId,
      thirdPartyProvider: null,
      thirdPartyTokenType: "jwt",
      encryptionKey: null,
      encryptionPart: encPart,
      encryptionSession: encSession,
      passkey: null,
      openfortURL: HOT_STORAGE_URL,
      shieldURL: COLD_STORAGE_URL,
    }),
    30000,
  );
  return result;
}


export async function disconnectIframe(): Promise<void> {
  if (_connection) {
    try {
      await withTimeout(_connection.logout({}), 5000);
    } catch {
      /* ignore */
    }
  }
  _connection = null;
  if (_iframe) {
    _iframe.remove();
    _iframe = null;
  }
}
