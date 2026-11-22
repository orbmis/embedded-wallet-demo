# Embedded Wallet Demo

A local two-panel web app (`http://localhost:7060`) that shows an end-to-end embedded wallet connected to a dApp via the EIP-6963 wallet-discovery standard, with real on-chain transactions submitted through ERC-4337 UserOperations.

## What it demonstrates

| Step | Where |
|---|---|
| Sign in with Google (or email/password in dev mode) | Wallet panel |
| Create wallet — key split into device, hot and cold shares via OpenSigner | Wallet panel |
| Recover wallet on a new device (incognito window) | Wallet panel |
| Wallet announces itself via **EIP-6963** | Automatic on load |
| Embedded wallet connection synchronizes automatically when ready; other discovered wallets can be selected manually | dApp ← Wallet panel |
| dApp shows Nexus Account address and Sepolia balance | dApp |
| **Send ETH** → review amount, sender, recipient and network → approve → Pimlico broadcasts → Etherscan link | dApp ← Wallet panel |
| **Receive** tab shows full address for funding | dApp |

## Architecture

```
Browser (localhost:7060, Next.js)
│
├── DApp (left panel)
│   ├── EIP-6963 wallet discovery (eip6963:requestProvider event)
│   ├── Balance: viem publicClient → Sepolia RPC
│   └── Send: permissionless SmartAccountClient
│            ├── buildUserOp → personal_sign → Wallet panel approval
│            ├── Pimlico verifying paymaster (sponsors gas)
│            └── Pimlico bundler → Sepolia on-chain
│
└── Wallet panel (desktop sidebar / mobile sheet opened with Wallet button)
    ├── better-auth client → auth_service :7052 ──OAuth──▶ Google
    │        GET /api/auth/token (cookie) → JWT
    ├── hidden <iframe src=:7050> ◀─Penpal─▶ create / sign / recover
    │                                    ├─▶ hot_storage :7054
    │                                    └─▶ Shield :7053
    ├── Next API route /api/shield/session  (server-only secrets)
    └── EIP-1193 provider singleton → announces via EIP-6963
```

### Key shares — where they are stored

The private key is split into three shares using **Shamir Secret Sharing** (threshold 2-of-3: any two shares reconstruct the key). It is **not** MPC/TSS — the full key is briefly assembled inside the iframe's memory during signing and immediately discarded.

| Share | Storage location | Encrypted with | Access control |
|---|---|---|---|
| **Device share** | Browser IndexedDB at the iframe's origin (`localhost:7050`) | — (browser sandbox) | Only code running at that origin can read it |
| **Hot share** | `hot_storage` Postgres database | `SHARE_ENCRYPTION_KEY` (server env var) | Valid JWT from `auth_service` required |
| **Cold share** | Shield (`cold_storage`) Postgres database | Project `encryption_part` | Valid JWT + correct Shield API key required |

#### Device share detail
Scoped to the iframe's origin, not the app's origin. This means:
- Survives page refreshes and browser restarts
- **Lost** in a fresh browser profile, incognito window, or new device — triggers the recovery flow
- The parent page (`localhost:7060`) cannot read it; only the iframe's own JavaScript can

#### Recovery
When the device share is missing, the iframe fetches the hot and cold shares (2-of-3 is sufficient), reconstructs the key, and re-stores the device share in the new browser's IndexedDB.

#### Cross-device and cross-dApp identity

The wallet's identity is anchored to the **user ID in `auth_service`**, which is permanently bound to the Google account. This means:

```
Same Google account
  → same user ID in JWT
  → same account in hot_storage  →  same hot share
  → same user in Shield          →  same cold share
  → same private key on reconstruction
  → same EOA address
  → same Nexus address (deployment suite, initialization and index are pinned)
```

| Scenario | Same address? | Notes |
|---|---|---|
| Same Google account, same computer | ✓ immediately | Device share already in IndexedDB |
| Same Google account, new computer or browser | ✓ after one recovery click | Hot + cold shares reconstruct the key; device share written to new IndexedDB |
| Same Google account, different dApp (same backend) | ✓ | dApp is irrelevant to wallet identity |
| Different `auth_service` instance | ✗ | Different user ID → new account created |
| Same backend, different Nexus factory, validator or index | ✗ | EOA is the same; Smart Account address differs |
| Browser storage cleared before recovery | ✗ device share lost | Key is still recoverable from hot + cold — click Recover |

The recovery step on a new device is intentional: it is a security checkpoint. A new browser must prove it can authenticate (obtain a valid JWT) before the key is reconstructed there.

#### Security implication in this demo

```
This operator controls:
  hot_storage  →  hot share   ✓
  Shield       →  cold share  ✓
                  ──────────────
                  can reconstruct any user's key
```

Both services run under the same operator in this local setup, making it **custodial in practice**. In a production deployment you would break this by:
- Having Shield operated by an independent third party, or
- Using password or passkey recovery so the user holds the cold share's encryption key (not the operator)

The private key is reconstructed inside the iframe in memory and never exposed to the host page.

### Why ERC-4337 for transactions

The OpenSigner iframe signs with **EIP-191** (`personal_sign`), which is incompatible with raw Ethereum transaction signatures. Nexus 1.3.3 with its MEE K1 ECDSA validator accepts EIP-191 signatures of the EntryPoint v0.7 UserOperation hash. So the same signing key works for both message signing and on-chain transactions once routed through a UserOperation.

The Smart Account is a counterfactual **Biconomy Nexus 1.3.3** account, created through `@biconomy/abstractjs` 2.0.3 using the explicitly pinned MEE 2.2.3 deployment suite, with `permissionless` 0.5.x handling Pimlico bundling and EntryPoint v0.7. It is deployed on the first transaction. Address derivation uses the owner plus fixed parameters in `web/lib/erc4337.ts`:

- Factory: `0x0000b1C08f1418dA76B5E99c1Bf5718486cf8c53`
- K1 validator: `0x0000B1C0790E5a28293276C320d2B95D651dBaD6`
- Implementation: `0x0000B1c01cB3b5770D8806f0D214d50131a08a5B`
- Index: `0`; default owner validator; no optional executor, hook or fallback modules
- EntryPoint: `0x0000000071727De22E5E9d8BAf0edAc6f37da032`

### Migration from SimpleAccount

This creates a **new smart account address** for existing users. It does not upgrade or move assets from their old SimpleAccount. The OpenSigner owner key and its share-recovery flow remain unchanged. Before using the new address, record the old account address and arrange any asset transfers separately through the old integration. Never pass an old SimpleAccount address as an existing Nexus account.

When switching to this branch, stop the existing dev server, install the updated dependencies with Node.js 22.13 or newer, and restart:

```bash
nvm use 22
cd web
pnpm install --frozen-lockfile
pnpm dev
```

Refresh the browser after restarting. The account card and Receive tab display the new Nexus address.

The existing Sepolia `NEXT_PUBLIC_PIMLICO_URL` can be retained if its bundler and paymaster support EntryPoint v0.7. No new signing key or backend account is required. Modules such as session keys and recovery validators are not installed by this migration. The selected suite initializes without a module registry; review module installation controls before adding extensions in production.

---

## Authentication: auth_service and better-auth

### better-auth

[better-auth](https://better-auth.com) is an open-source TypeScript authentication library — a self-hosted alternative to Auth0 or Clerk. It handles:

- User registration and login (email/password and social providers like Google)
- Session management via HTTP-only cookies
- JWT issuance through its `jwt` plugin
- Database persistence (Postgres)
- A JWKS endpoint (`/.well-known/jwks.json`) so other services can verify its tokens independently

### auth_service

`auth_service` is a small Express server (`vendor/opensigner/auth_service/src/server.ts`) that wraps better-auth and exposes it as a standalone HTTP service on port 7052. OpenSigner ships it as a separate process so any frontend or backend can authenticate against it independently.

The only modification in this repo is the Google social provider — a 7-line patch in `patches/auth-google.patch`. Everything else (JWT signing, JWKS, rate limiting, session cookies) is stock better-auth.

### Why every other service depends on it

```
auth_service issues JWTs (signed with JWT_SECRET)
       │
       ├── hot_storage  — verifies JWTs before returning any share
       │                  (fetches JWKS from http://authservice:3000/.well-known/jwks.json)
       │
       ├── Shield       — verifies JWTs via the "custom" provider configured at bootstrap
       │                  (same JWKS URL, internal docker hostname)
       │
       └── iframe       — receives JWT in every create / sign / recover call
                          and passes it to hot_storage and Shield to identify the user
```

The JWT is the thread that connects everything. It carries the user ID, and that user ID is what links a Google identity to a specific set of shares in hot_storage and Shield. A valid JWT from *this* auth_service instance is required before either storage service will hand over a share — which is why pointing at a different backend produces a different wallet.

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Docker Desktop | any | Must be **running** before `make up` |
| Docker Compose | ≥ 2.24 | Installed automatically to `~/.docker/cli-plugins/` by `make setup` if needed |
| Node.js | ≥ 22 | Use nvm: `nvm install 22 && nvm use 22` |
| pnpm | ≥ 11 | `npm install -g pnpm` |
| openssl | any | Comes with macOS/Linux |

> **macOS Docker Desktop note:** Docker Desktop uses a non-default socket. If you see `Cannot connect to the Docker daemon`, run `export DOCKER_CONTEXT=desktop-linux` or add it to your shell profile.

---

## Quick start

### 1 — Clone and generate secrets

```bash
git clone https://github.com/orbmis/embedded-wallet-demo
cd embedded-wallet-demo
make setup    # generates .env.opensigner, applies Google patch
```

### 2 — Google OAuth (optional)

Skip this step to use email/password dev login instead.

1. [Google Cloud Console](https://console.cloud.google.com/) → Credentials → Create OAuth 2.0 Client ID → Web application
2. Authorised JavaScript origin: `http://localhost:7060`
3. Authorised redirect URI: `http://localhost:7052/api/auth/callback/google`
4. Create `.env.google` in the project root:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```

### 3 — Start backend services

```bash
make up       # starts postgres, auth_service, iframe, hot_storage, Shield
```

Both `http://localhost:7052/health` and `http://localhost:7054/health` should return `{"status":"ok"}`.

### 4 — Bootstrap Shield

```bash
make bootstrap   # creates Shield project, writes web/.env.local
```

This is idempotent — re-running skips if `web/.env.local` already has the keys.

### 5 — Get a Pimlico API key (required for transactions)

1. Sign up free at [dashboard.pimlico.io](https://dashboard.pimlico.io) (no credit card)
2. Create an API key
3. Append to `web/.env.local`:
   ```
   NEXT_PUBLIC_PIMLICO_URL=https://api.pimlico.io/v2/sepolia/rpc?apikey=YOUR_KEY
   ```

Without this, the wallet and signing work, but the Send button will error.

### 6 — Start the web app

```bash
make dev      # Next.js dev server on http://localhost:7060
```

---

## Full env-var reference

### `web/.env.local` — written by `make bootstrap`, extend manually

| Variable | Server/Client | Description |
|---|---|---|
| `SHIELD_API_KEY` | Server | Shield project API key |
| `SHIELD_API_SECRET` | Server | Shield project API secret (never exposed to browser) |
| `SHIELD_ENCRYPTION_PART` | Server | Shield encryption part (never exposed to browser) |
| `NEXT_PUBLIC_SHIELD_API_KEY` | Client | Public Shield key (the iframe reads this) |
| `NEXT_PUBLIC_AUTH_URL` | Client | `http://localhost:7052` |
| `NEXT_PUBLIC_HOT_STORAGE_URL` | Client | `http://localhost:7054` |
| `NEXT_PUBLIC_COLD_STORAGE_URL` | Client | `http://localhost:7053` |
| `NEXT_PUBLIC_IFRAME_URL` | Client | `http://localhost:7050/index.html?debug=true` |
| `NEXT_PUBLIC_PIMLICO_URL` | Client | Pimlico bundler+paymaster RPC URL — **add this manually** |

### `.env.opensigner` — generated by `make setup`

Generated secrets for Docker Compose (JWT signing key, DB passwords, share encryption key). Never commit this file.

### `.env.google` — optional

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

### Dev login flag

To show the email/password form in addition to Google:

```bash
NEXT_PUBLIC_DEV_EMAIL_LOGIN=true make dev
```

---

## Wallet connection and mobile behavior

The dApp reads the embedded provider's current account and listens for account changes. When the wallet becomes ready, the dApp initializes the Nexus account automatically. Logout clears the connection. Background session refreshes for the same user preserve the connection and transaction UI.

On mobile, the **Wallet** button opens the wallet sheet. Transaction approvals appear in a separate modal and do not automatically open the sheet. The modal displays the amount, full sender and recipient addresses, network, gas sponsorship and an expandable signing hash. Approval shows signing progress, then closes after signing; the dApp continues showing submission and confirmation progress.

## How the transaction flow works

```
User clicks Send
  → DApp calls saSetup.send(to, value)
  → permissionless builds UserOp with Pimlico paymaster calldata
  → SmartAccountClient calls personal_sign(userOpHash, ownerAddress)
  → walletProvider queues pending request
  → A separate "Authorize Transaction" modal shows the transfer details
  → User approves
  → signRaw() sends raw 32-byte userOpHash to OpenSigner iframe
  → Iframe applies EIP-191 prefix → Nexus MEE K1 validator-compatible signature
  → UserOp submitted to Pimlico bundler
  → Pimlico paymaster sponsors gas (the transfer amount still requires ETH in the account)
  → Bundler submits on-chain
  → App waits for the submitted UserOperation hash and checks execution success
  → Etherscan link shown (or JiffyScan link if still pending)
```

> The Smart Account is **counterfactual** (not yet deployed) until the first transaction. The first v0.7 UserOp includes `factory` and `factoryData` to deploy it atomically — this is normal ERC-4337 behaviour.

---

## Running tests

Use Node.js 22.13 or newer for the current tooling. Run `pnpm test`, `pnpm exec tsc --noEmit` and `pnpm build` from `web/`.

A read-only live Sepolia check is available from `web/`:

```bash
node --env-file=.env.local --import tsx scripts/verify-nexus.ts
```

This checks deployment bytecode, bundler EntryPoint v0.7 support, and deterministic Nexus address derivation. It never signs or submits a transaction. An optional live transaction check is also available. It creates a fresh temporary test key and submits a **zero-ETH transfer on Sepolia**, with gas paid by the configured Pimlico sponsorship. It does not use the logged-in user's wallet:

```bash
node --env-file=.env.local --import tsx scripts/verify-nexus-transfer.ts
```

Unit tests additionally exercise the real Nexus SDK's EIP-191 UserOperation signing through the wallet provider, approval metadata, rejected signatures, execution failure, pending confirmations and overlapping sends.

```bash
make test   # Vitest: signature helpers, provider approvals and Nexus integration
make e2e    # Legacy Playwright wallet flow; selectors need updating for the current UI
```

The legacy Playwright suite uses email/password login, but its selectors target an older UI and it has not been validated for this migration. Use the unit tests and the Nexus smoke scripts above for the checks added on this branch.

---

## Makefile targets

| Target | Description |
|---|---|
| `make setup` | Generate secrets, apply Google auth patch |
| `make up` | Start all Docker services, wait for health |
| `make bootstrap` | Create Shield project, write `web/.env.local` |
| `make dev` | Start Next.js on :7060 |
| `make test` | Vitest unit tests |
| `make e2e` | Playwright E2E tests |
| `make logs` | Tail all service logs |
| `make down` | Stop services, keep data volumes |
| `make nuke` | ⚠ Stop services and destroy all volumes |

---

## Troubleshooting

| Symptom | Likely cause & fix |
|---|---|
| `Cannot connect to the Docker daemon` | Docker Desktop isn't running, or wrong context. Run `export DOCKER_CONTEXT=desktop-linux` |
| Iframe blank / Penpal timeout | App origin not in `ALLOWED_ORIGINS`. Check `docker logs iframe` for 403s |
| `401` from hot_storage | JWT expired or `iss`/`aud` mismatch. `BETTER_AUTH_BASE_URL` must equal `http://localhost:7052` |
| Shield `401` on shares | JWK URL must be the internal hostname: `http://authservice:3000/.well-known/jwks.json` |
| Google `redirect_uri_mismatch` | Redirect URI in Console must be exactly `http://localhost:7052/api/auth/callback/google` |
| `make dev` → `No rule to make target 'dev'` | Wrong directory. Run from the project root: `cd embedded-wallet-demo` |
| `make bootstrap` → `bootstrap requires Node ≥22` | Run `nvm use 22` first, or the Makefile will find it automatically if nvm is installed |
| Broken pnpm lockfile | Delete `web/pnpm-lock.yaml` and re-run `make bootstrap` |
| `SA setup failed` in dApp | `NEXT_PUBLIC_PIMLICO_URL` missing from `web/.env.local`. Restart dev server after adding it |
| `401 Unauthorized` from Pimlico | API key wrong or expired. Check `dashboard.pimlico.io` |
| `AA21 didn't pay prefund` | Paymaster not wired up. Ensure `NEXT_PUBLIC_PIMLICO_URL` is set and server was restarted |
| Postgres password error after editing `.env` | Password is fixed at volume creation time. `make nuke` (destroys data) then `make up` |
| Shield keeps restarting | Normal under repeated test load. The fallback in `/api/shield/session` handles it; wait ~10s |

---

## Production caveats

This is a local demo, not production-ready:

- **Custodial risk** — the same operator holds both `SHIELD_ENCRYPTION_PART` and `SHARE_ENCRYPTION_KEY`, so they could reconstruct any user's key. In production, use a third-party custody model for the encryption part.
- **No TLS** — all backend communication is plain HTTP. Set `BETTER_AUTH_BASE_URL` to an `https://` URL in production and enable `DB_SSLMODE=require`.
- **Shared Postgres** — all three services share one database instance. Use separate instances in production.
- **`iframe?debug=true`** — enables verbose iframe logging. Remove the query string in production.
- **Pimlico free tier** — has rate limits. Use a paid plan or self-host a bundler for production traffic.

## Production roadmap

See **[PRODUCTION.md](./PRODUCTION.md)** for a full breakdown of what needs to change before this POC becomes a production deployment — covering custodial risk, TLS, secrets management, ERC-4337 upgrades, key rotation, disaster recovery, and compliance.

## Alternatives and extensions

- **Raw Google ID tokens** — `hot_storage` supports `X-Auth-Provider: google` with `GOOGLE_JWT_AUDIENCE`, bypassing better-auth. Shield would need a separate Google JWK provider. More complex and untested in this demo.
- **Password / passkey recovery** — the OpenSigner iframe supports `recoveryMethod: "password"` and WebAuthn PRF passkey recovery. See `setRecoveryMethod` in the sample HTML.
- **EIP-712 typed data** — not supported by the current OpenSigner adapter. Adding it requires compatible digest signing and verification; signing an EIP-712 hash with `personal_sign` adds an EIP-191 prefix and is not equivalent to an EIP-712 signature.
- **Other bundlers** — any ERC-4337 bundler that speaks the standard JSON-RPC interface works. Replace the Pimlico URL with Alchemy, Stackup, or a self-hosted Alto instance.
