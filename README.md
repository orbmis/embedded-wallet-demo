# Embedded Wallet Demo

A local web app (`http://localhost:7060`) demonstrating a non-custodial embedded wallet built on [OpenSigner](https://github.com/openfort-xyz/opensigner).

## What it demonstrates

1. **Continue with Google** (or email/password in dev mode) → user session
2. **Create wallet** → key generated inside the OpenSigner iframe, split into device, hot, and cold shares
3. Show the **address** (copy button) and **Sepolia balance**
4. **Sign a message** → signature verified with viem (✓ only if the recovered signer equals the wallet address)
5. **Recover on a new device** (incognito window) → same address, signing works
6. **Log out**

## Architecture

```
Browser (localhost:7060, Next.js)
 ├─ better-auth client → auth_service :7052 ──OAuth──▶ Google
 │      GET /api/auth/token (cookie) → JWT
 ├─ hidden <iframe src=:7050> ◀─Penpal─▶ create / sign / recover(JWT, URLs)
 │                                   ├─▶ hot_storage :7054
 │                                   └─▶ Shield :7053
 └─ Next API route /api/shield/session  (server-only; holds Shield secrets)
```

### Key shares
- **Device share**: held by the iframe in browser storage (IndexedDB)
- **Hot share**: encrypted by `SHARE_ENCRYPTION_KEY` in `hot_storage`
- **Cold share**: held by Shield (cold_storage), encrypted with the project's `encryption_part`

The key is reconstructed in the iframe's memory; it never leaves the iframe.

## Prerequisites

- Docker Desktop (running)
- Docker Compose ≥ 2.24
- Node.js ≥ 22 (via nvm: `nvm use 22`)
- pnpm ≥ 11
- openssl

## Quick start

```bash
# 1. Generate secrets and start services
make setup up

# 2. Bootstrap Shield (creates project + writes web/.env.local)
make bootstrap

# 3. Start the web app
make dev
# → http://localhost:7060
```

## Google OAuth setup (optional)

Without Google credentials the app falls back to email/password login (enabled by `NEXT_PUBLIC_DEV_EMAIL_LOGIN=true` in dev mode).

To enable Google login:

1. [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID → Web application
2. Authorised JavaScript origin: `http://localhost:7060`
3. Authorised redirect URI: `http://localhost:7052/api/auth/callback/google`
4. Add credentials to `.env.google`:
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
5. Run `make setup up` again (rebuilds auth_service with Google provider)

## Running tests

```bash
# Unit tests
make test

# E2E tests (Playwright, Chromium, email login)
make e2e
```

## Makefile targets

| Target | Description |
|---|---|
| `make setup` | Generate secrets, apply Google patch |
| `make up` | Start all Docker services |
| `make bootstrap` | Create Shield project, write `web/.env.local` |
| `make dev` | Start Next.js dev server on :7060 |
| `make test` | Run vitest unit tests |
| `make e2e` | Run Playwright E2E tests |
| `make logs` | Tail service logs |
| `make down` | Stop services, keep data |
| `make nuke` | ⚠ Destroy all data volumes |

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Penpal connect timeout / iframe blank | App origin missing from `ALLOWED_ORIGINS` (iframe 403). Check `docker logs iframe` |
| 401 from hot storage | Expired JWT, or `iss`/`aud` mismatch: `BETTER_AUTH_BASE_URL` must be `http://localhost:7052` |
| Shield 401 on shares | Custom provider JWK URL must be internal (`authservice:3000`), or the project provider isn't set |
| Google `redirect_uri_mismatch` | Console URI must be exactly `http://localhost:7052/api/auth/callback/google` |
| `/api/auth/token` returns 401 | Missing `credentials: "include"`, or `:7060` not in trustedOrigins |
| Postgres auth fails after editing `.env` | Password is fixed at volume creation. Run `make nuke` (data loss) or `ALTER USER` |
| Docker Desktop not running | Start Docker Desktop before `make up` |

## Demo caveats (not for production)

- **Custodial risk**: this operator holds both Shield (`encryption_part`) and hot_storage (`SHARE_ENCRYPTION_KEY`), so they can reconstruct the key. In production, the encryption part should be managed by a third party or the user.
- **No TLS**: all services communicate over plain HTTP. Set `BETTER_AUTH_BASE_URL` to an https URL in production.
- **Shared Postgres**: all three databases share one postgres instance. Use separate instances in production.
- **`iframe?debug=true`**: enables verbose iframe logging. Remove in production.

## Alternative: raw Google ID tokens

Instead of using Google as a Better Auth social provider, the iframe supports `thirdPartyProvider: "google"` with raw Google ID tokens and `GOOGLE_JWT_AUDIENCE` set in hot_storage. Shield would need a separate provider entry for Google JWKs. This path is more complex and unvalidated; the social-provider approach in this demo is simpler.
