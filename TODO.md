# TODO

## M0 — Preflight ✓
- [x] Check docker, docker compose, node ≥ 22, pnpm, openssl
- [x] Ask for Google credentials (human checkpoint)
- [x] Record Google credentials in .env.google

## M1 — Run stock OpenSigner ✓
- [x] Clone vendor/opensigner @ 533fb30
- [x] Write scripts/gen-secrets.sh (idempotent)
- [x] Generate .env.opensigner
- [x] Write infra/compose.app.yml
- [x] Write Makefile
- [x] `make up` — services healthy
- [x] Gate: curl :7052/health, :7054/health return ok

## M2 — Google in auth_service ✓
- [x] Edit vendor/opensigner/auth_service/src/server.ts
- [x] Save patches/auth-google.patch
- [x] infra/compose.app.yml: add GOOGLE_CLIENT_ID/SECRET + ALLOWED_ORIGINS
- [x] Gate: validate-origin returns 200 for :7060
- [x] Gate: Google social login returns URL

## M3 — Shield bootstrap ✓
- [x] Write scripts/bootstrap-shield.ts
- [x] Run bootstrap → web/.env.local populated
- [x] Gate: web/.env.local has SHIELD_API_KEY, SHIELD_API_SECRET, SHIELD_ENCRYPTION_PART

## M4 — Web app core libs ✓
- [x] Init Next.js 15 app in web/
- [x] lib/auth.ts
- [x] lib/signer.ts
- [x] lib/chain.ts
- [x] app/api/shield/session/route.ts (with encryptionPart fallback)
- [x] Gate: tsc --noEmit clean

## M5 — Widget UI ✓
- [x] components/WalletWidget.tsx (sign probe for needsRecovery detection)
- [x] components/ActivityLog.tsx
- [x] app/page.tsx
- [x] Gate: dev server starts; app loads

## M6 — Tests ✓
- [x] Unit tests (vitest) — chain.test.ts (3 tests)
- [x] E2E tests (Playwright, 4 tests)
- [x] Gate: all tests pass

## M7 — Docs ✓
- [x] README.md
- [x] .env.example
- [x] .gitignore

## §9 Definition of Done
- [x] make setup up bootstrap runs cleanly (see NOTES.md for docker context requirement)
- [x] Re-running is a no-op (gen-secrets.sh checks for existing file)
- [x] Only change to OpenSigner is patches/auth-google.patch
- [x] Playwright e2e 1–4 pass (4 passed in 7.2s)
- [x] Unit tests pass (3 passed)
- [x] tsc --noEmit clean
- [x] No Shield secret in client bundle (verified)
- [x] NOTES.md records iframe response shapes, hashing scheme, encryption approach
- [x] README covers setup, demo, caveats
