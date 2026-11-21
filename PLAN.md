# PLAN.md — Embedded wallet with Google login on OpenSigner

> **Kickoff prompt for Claude Code** (run in an empty directory containing only this file):
>
> *Read PLAN.md end to end, then execute it milestone by milestone without stopping to ask, except at the one human checkpoint in §0. Track progress in TODO.md, record every discovery or deviation in NOTES.md, and don't declare done until every check in §9 passes.*

---

## 1. Goal

A local web app (`http://localhost:7060`) with a small **wallet widget** that proves a non-custodial embedded wallet works end to end:

1. **Continue with Google** → user session
2. **Create wallet** → key generated inside the OpenSigner iframe and split into device, hot and cold shares
3. Show the **address** (copy button) and **Sepolia balance**
4. **Sign a message** → signature checked in-app with viem (✓ shown only if the recovered signer equals the address)
5. **Recover on a new device** (incognito window) → same address, signing works
6. **Log out**

Out of scope: production hardening, smart accounts or paymasters, sending transactions (stretch goal only, see §8).

## 2. Framework facts (checked against `openfort-xyz/opensigner` @ `533fb30`, 2026-11-19)

| Component | Host port | Source | Notes |
|---|---|---|---|
| iframe | 7050 | **prebuilt image pinned by digest**, no source in repo | Holds the device share; reconstructs the key in memory; exposes methods over **Penpal v7** (`create`, `sign`, `recover`, `setRecoveryMethod`, …) |
| iframe-sample | 7051 | `iframe/sample/index.html` | **The reference integration.** Copy its request shapes exactly. |
| auth_service | 7052 | `auth_service/src/server.ts` (Better Auth 1.7.16, Express) | Email/username only. Issues JWTs via `GET /api/auth/token`; JWKS at `/.well-known/jwks.json` |
| cold_storage (Shield) | 7053 | image `ghcr.io/openfort-xyz/shield:v0.5.2` | Projects, API key/secret, `encryption_part`, auth providers |
| hot_storage | 7054 | `hot_storage/sample` (Go) | Checks JWTs against auth_service; `/v2/accounts`, `/v2/devices/*` |
| postgres | (7056 optional) | postgres:16 | DBs: authservice, hotstorage, shield |

Key behaviours:
- `ALLOWED_ORIGINS` is used **three times**: auth CORS/trustedOrigins, hot storage CORS, and the iframe's `frame-ancestors` (nginx `auth_request` → `/v1/projects/validate-origin`, using Origin/Referer). **The app origin must be in it**, or the iframe returns 403 and Penpal times out.
- Compose needs every REQUIRED secret in `.env` (`JWT_SECRET` ≥32 chars, `SHARE_ENCRYPTION_KEY` = 64 hex chars, DB passwords in hex). Set the DB passwords **before the first start**.
- `make run` applies `docker-compose.dev.yml` (DB TLS off, insecure JWKS fetch allowed). Use the same overlays.
- `make clean` wipes the volumes. Never run it; use `docker compose down`.

## 3. Architecture decision: how Google login plugs in

**Chosen: add Google as a Better Auth social provider in `auth_service`.** After the OAuth callback the user has a normal Better Auth session, and `/api/auth/token` issues the same first-party JWT the sample uses. Hot storage (default provider) and Shield (`custom` JWK provider) already trust that JWT, so nothing else changes.

Rejected: sending raw Google ID tokens (`X-Auth-Provider: google`). Hot storage supports it via `GOOGLE_JWT_AUDIENCE`, but Shield would need separate provider config, the iframe's `thirdPartyProvider` path is untested in the sample, and there are more ways to fail. Note it in the README as an alternative.

```
Browser (localhost:7060, Next.js)
 ├─ better-auth client → auth_service :7052 ──OAuth──▶ Google
 │      GET /api/auth/token (cookie) → JWT
 ├─ hidden <iframe src=:7050> ◀─Penpal─▶ create / sign / recover(JWT, URLs)
 │                                   ├─▶ hot_storage :7054
 │                                   └─▶ Shield :7053
 └─ Next API route /api/shield/session  (server-only; holds Shield secrets)
```

## 4. Repo layout to create

```
embedded-wallet-demo/
├─ vendor/opensigner/            # git clone, checkout 533fb30 (do not edit except via patches/)
├─ patches/auth-google.patch     # the only change to OpenSigner
├─ infra/compose.app.yml         # overlay: Google env + ALLOWED_ORIGINS
├─ .env.opensigner               # generated secrets for compose (gitignored)
├─ .env.example                  # documents every variable incl. Google
├─ scripts/
│  ├─ gen-secrets.sh             # writes .env.opensigner with openssl values (idempotent)
│  └─ bootstrap-shield.ts        # creates Shield project + custom provider → web/.env.local
├─ web/                          # Next.js 15 App Router, TS, Tailwind, port 7060
│  ├─ app/page.tsx               # landing + <WalletWidget/>
│  ├─ app/api/shield/session/route.ts
│  ├─ lib/auth.ts                # better-auth client + getJwt()
│  ├─ lib/signer.ts              # iframe + Penpal wrapper (typed)
│  ├─ lib/chain.ts               # viem public client (sepolia), verify helpers
│  └─ components/WalletWidget.tsx, ActivityLog.tsx
├─ e2e/                          # Playwright
├─ Makefile                      # up / down / bootstrap / dev / test / logs
├─ TODO.md, NOTES.md, README.md
```

Package manager: pnpm. Deps for `web`: `next`, `react`, `better-auth` (client, **same major version as the service**), `penpal@^7`, `viem`, `jose`, `tailwindcss`. Dev: `@playwright/test`, `tsx`.

## 5. Milestones

### M0 — Preflight and human checkpoint (the only stop)
- Check `docker`, `docker compose`, `node ≥ 22`, `pnpm`, `openssl`. Install whatever is missing, or stop with exact install instructions.
- Ask the human **once** for `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and print these setup steps:
  - Google Cloud Console → Credentials → OAuth client ID → *Web application*
  - Authorized JavaScript origin: `http://localhost:7060`
  - Authorized redirect URI: `http://localhost:7052/api/auth/callback/google`
- **If no credentials are given, carry on.** Google is env-gated (see M2), and email/password stays enabled as a dev fallback so the whole wallet flow can still be built and tested by Playwright.

### M1 — Run stock OpenSigner
- Clone into `vendor/opensigner` and check out `533fb30`.
- `scripts/gen-secrets.sh`: generate `.env.opensigner` (`JWT_SECRET=$(openssl rand -base64 48)`, `SHARE_ENCRYPTION_KEY=$(openssl rand -hex 32)`, one hex DB password used for `POSTGRES_PASSWORD` and the three `*_DB_PASS`). Never overwrite an existing file.
- Makefile `up` target:
  ```
  docker compose --project-directory vendor/opensigner --env-file .env.opensigner \
    -f vendor/opensigner/docker-compose.yml -f vendor/opensigner/docker-compose.dev.yml \
    -f infra/compose.app.yml up -d --build postgres auth_service iframe iframe-sample hot_storage cold_storage
  ```
- **Gate:** `curl :7052/health` and `:7054/health` return ok. Then open `http://localhost:7051` with Playwright and run the stock sample flow (register → login → get JWT → create cold-storage project → set up provider → create via iframe → sign). If this fails, fix the environment before writing app code. Record the actual `create` / `sign` response shapes in NOTES.md, because M4 depends on them.

### M2 — Google in auth_service (patch, not fork)
Edit `vendor/opensigner/auth_service/src/server.ts`, then save the diff to `patches/auth-google.patch` (Makefile `patch` target applies it idempotently with `git apply --check` first):
```ts
socialProviders: process.env.GOOGLE_CLIENT_ID ? {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    prompt: "select_account",
  },
} : undefined,
```
`infra/compose.app.yml`:
```yaml
services:
  auth_service:
    environment:
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      ALLOWED_ORIGINS: http://localhost:7050,http://localhost:7051,http://localhost:7060
  hot_storage:
    environment:
      ALLOWED_ORIGINS: http://localhost:7050,http://localhost:7051,http://localhost:7060
```
- Rebuild `auth_migrate` and `auth_service`. Better Auth's `account` table already covers social accounts. If migrate reports schema drift, re-run it; don't hand-edit the DB.
- **Gate:** `POST :7052/api/auth/sign-in/social {"provider":"google","callbackURL":"http://localhost:7060"}` returns a Google `url` (only when credentials exist), and `GET :7052/v1/projects/validate-origin` with `X-Request-Origin: http://localhost:7060` returns 200.

### M3 — Shield bootstrap (server-side secrets)
`scripts/bootstrap-shield.ts` (run with tsx, idempotent: skip if `web/.env.local` already has the keys):
1. `POST :7053/register {"name":"embedded-wallet-demo","generate_encryption_key":true}` → `api_key`, `api_secret`, `encryption_part`
2. `POST :7053/project/providers` (headers `X-API-Key`, `X-API-Secret`) body `{"providers":{"custom":{"jwk":"http://authservice:3000/.well-known/jwks.json"}}}`. Use the **internal** hostname, because Shield fetches it from inside the docker network.
3. Write `web/.env.local`: `SHIELD_API_KEY`, `SHIELD_API_SECRET`, `SHIELD_ENCRYPTION_PART` (server-only), `NEXT_PUBLIC_SHIELD_API_KEY` (the iframe needs it client-side, as in the sample), and the public service URLs.

### M4 — Web app core libs
- **`lib/auth.ts`**: `createAuthClient({ baseURL: "http://localhost:7052" })`; `signInWithGoogle()` → `signIn.social({ provider: "google", callbackURL: "http://localhost:7060/" })`; email/password fallback behind `NEXT_PUBLIC_DEV_EMAIL_LOGIN=true`; `getJwt()` = `fetch(":7052/api/auth/token", { credentials: "include" })`. Cookies on `localhost` are shared across ports and the hosts are same-site, so this works. **Fetch a fresh JWT before every iframe call**, because tokens are short-lived.
- **`lib/signer.ts`**: create a hidden iframe at `http://localhost:7050/index.html?debug=true`, then `Penpal.connect({ messenger: new WindowMessenger({ remoteWindow, allowedOrigins: ["http://localhost:7050"] }), methods: {…no-op stubs matching the sample: sign, updateAuthentication, logout, export, setRecoveryMethod, getCurrentDevice}, timeout: 10000 })`. Use a singleton connection and wrap each call in a 30-second timeout. Expose typed `create()`, `sign(message)`, `recover(accountId)`, `logout()`.
  - **Request bodies: copy `createAccountIframe`, `signMessage` and `confirmRecover` from `vendor/opensigner/iframe/sample/index.html` field for field.** Swap in our JWT, user ID, URLs and `NEXT_PUBLIC_SHIELD_API_KEY`. Keep `recovery.auth: "custom"`, `authProvider: "authservice"`, `tokenType: "jwt"`, and `accountType: "Smart Account"` as the sample has it.
  - **Automatic recovery, preferred path:** before `create`/`recover`, call our `/api/shield/session`. It verifies the caller's JWT against `:7052/.well-known/jwks.json` with jose, then calls `POST :7053/project/encryption-session {encryption_part}` server-side and returns `session_id`. Pass that as `encryptionSession` and `recovery.encryptionSession`, with `encryptionPart: null`.
  - **Fallback if the iframe rejects sessions:** pass `encryptionPart` the way the sample does, served by the same route. Label it "DEMO ONLY – custodial risk" in NOTES.md and the README.
- **`lib/chain.ts`**: viem `createPublicClient({ chain: sepolia, transport: http() })`, `getBalance`, and `verifySignature(address, message, sig)`. **Find out empirically** which hashing the iframe uses: try `recoverMessageAddress({ message })` (EIP-191) first, then `recoverAddress({ hash: keccak256(bytes) })` and the raw variants. Lock in whichever recovers the wallet address and note it in NOTES.md.
- **Wallet discovery:** after login, `GET :7054/v2/accounts` (Bearer JWT) works out the state: *no account* → offer Create; *account exists* → try a silent `sign` probe, or check for a device share (`getCurrentDevice` if exposed). If there's no local share, show "Recover on this device".

### M5 — Widget UI
One card, bottom right, with a state machine: `signedOut → noWallet → ready | needsRecovery`, plus `busy` and `error` overlays.
- **signedOut:** "Continue with Google" button (Google G mark from a generic SVG, no brand assets beyond the standard button guidelines); dev email form if enabled.
- **noWallet:** "Create wallet" button, with a one-line note on automatic recovery.
- **ready:** user email/avatar, truncated address with copy button and Sepolia Etherscan link, balance (refresh button, link to a faucet), message input → **Sign** → signature with a green ✓ "Verified: signer = wallet address" or a red ✗, and a Log out button.
- **needsRecovery:** "Recover wallet on this device" button → `recover(accountId)` → ready.
- A collapsible **ActivityLog** panel shows each step: auth, JWT, iframe connected, share operations, timings. Never log JWTs, shares or secrets, only their first 8 characters.

### M6 — Tests
- Unit (vitest): state machine reducer, `verifySignature`, JWT verify in the session route.
- E2E (Playwright, Chromium, dev email login so no Google is needed):
  1. sign up → create wallet → address matches `/^0x[0-9a-fA-F]{40}$/`
  2. sign "hello opensigner" → ✓ verified
  3. **new browser context** (empty iframe storage) → log in as the same user → needsRecovery → recover → **same address** → sign ✓
  4. log out → signedOut
- Google is checked manually: list the steps in the README and make a note if no credentials were given.

### M7 — Docs
README: prerequisites, Google console setup, `make up && make bootstrap && make dev`, the architecture diagram above, how the shares flow, demo-only caveats (shared DB, HTTP, `encryption_part` held by the same operator as Shield = custodial, iframe `debug=true`), the raw-Google-ID-token alternative, and troubleshooting (below).

## 6. Makefile targets
`setup` (secrets + clone + patch) · `up` · `bootstrap` · `dev` (`pnpm --dir web dev -p 7060`) · `test` · `e2e` · `logs` · `down` (keeps data) · `nuke` (prints a warning; wipes volumes).

## 7. Troubleshooting (put in README and check first)
| Symptom | Likely cause |
|---|---|
| Penpal connect timeout / iframe blank | App origin missing from `ALLOWED_ORIGINS` (iframe 403), or a strict `Referrer-Policy` on the app. Check `docker logs iframe` |
| 401 from hot storage | Expired JWT, or `iss`/`aud` mismatch: `BETTER_AUTH_BASE_URL` must stay `http://localhost:7052` |
| Shield 401 on shares | Custom provider JWK URL not internal (`authservice:3000`), or the project's provider isn't set |
| Google `redirect_uri_mismatch` | Console URI must be exactly `http://localhost:7052/api/auth/callback/google` |
| `/api/auth/token` returns 401 after Google | Missing `credentials: "include"`, or `:7060` not in trustedOrigins |
| Postgres auth fails after editing `.env` | Password fixed at volume creation. `make nuke` (data loss) or `ALTER USER` |

## 8. Stretch (only after §9 passes)
1. Password recovery option (`recoveryMethod: "password"`)
2. Passkey recovery via `setRecoveryMethod` (copy `registerPasskey` from the sample)
3. Sepolia send: sign a tx hash via `sign` with the sample's commented `requireHash/requireArrayify` flags and broadcast with viem. Only enable if the recovered signer matches.
4. EIP-712 typed-data signing

## 9. Definition of done
- [ ] `make setup up bootstrap` runs cleanly on a fresh machine; re-running is a no-op
- [ ] Only change to OpenSigner is `patches/auth-google.patch`; the iframe image digest is unchanged
- [ ] Playwright e2e 1–4 pass; unit tests pass; `tsc --noEmit` and lint are clean
- [ ] With Google credentials: manual Google login → create → sign ✓ → incognito recover → same address
- [ ] No Shield secret or `encryption_part` in any client bundle (`grep` the `.next/static` output)
- [ ] NOTES.md records the real iframe response shapes, the hashing scheme, and whether encryption sessions or the fallback was used
- [ ] README covers setup, the demo, and the caveats
