# NOTES

## Environment
- Node: v22.22.3 (via nvm), active v20.18.1 — use `nvm use 22` before pnpm commands
- Docker: 20.10.12 (desktop-linux context required)
- Docker Compose: v2.2.3 bundled; upgraded to v2.24.0 as CLI plugin at ~/.docker/cli-plugins/docker-compose
- pnpm: 11.18.0
- OpenSSL: 3.6.3
- DOCKER_CONTEXT=desktop-linux required (Docker Desktop uses a non-default socket)

## Deviations from PLAN.md
1. Docker Compose < 2.24 does not support `restart: true` in `depends_on`. Installed v2.24.0 as CLI plugin.
2. `infra/compose.app.yml` overrides `iframe`/`iframe-sample` depends_on without `restart: true` for compatibility (these lines are only needed for <2.24, harmless with 2.24).
3. `docker compose` requires `--env-file` to be a single file; Docker Compose v2.2.3 doesn't support multiple `--env-file`. Workaround: merge `.env.opensigner` and `.env.google` into `.env.combined`.
4. TypeScript strict mode in auth_service requires bracket notation: `process.env["GOOGLE_CLIENT_ID"]` not `process.env.GOOGLE_CLIENT_ID`.
5. `better-auth` v1.7.x: `useSession` is a method on the authClient object (`authClient.useSession()`), not a standalone import from `better-auth/react`.
6. Next.js 15 App Router: `ssr: false` in `next/dynamic` is only allowed inside a Client Component. Added `components/ClientShell.tsx` as a client wrapper.
7. Hot storage `GET /v2/accounts` returns `{ object: "list", data: [...], ... }` not a raw array.

## Iframe request shapes (from sample/index.html)
### createAccountIframe
```json
{
  "uuid": "<uuid>",
  "accountType": "Smart Account",
  "chainType": "EVM",
  "chainId": 11155111,
  "publishableKey": "<JWT>",
  "accessToken": "<JWT>",
  "userEntropy": "TODO",
  "projectEntropy": "TODO",
  "playerID": "<userId>",
  "thirdPartyProvider": null,
  "thirdPartyTokenType": "jwt",
  "encryptionKey": null,
  "encryptionPart": "<shield_encryption_part> OR null if using encryptionSession",
  "encryptionSession": "<session_id> OR null",
  "openfortURL": "http://localhost:7054",
  "shieldURL": "http://localhost:7053",
  "shieldAPIKey": "<shield_api_key>",
  "recovery": {
    "auth": "custom",
    "token": "<JWT>",
    "authProvider": "authservice",
    "tokenType": "jwt",
    "encryptionSession": "<session_id> OR null"
  }
}
```

### signMessage
```json
{
  "uuid": "<uuid>",
  "message": "<Uint8Array of encoded message>",
  "requestConfiguration": {
    "token": "<JWT>",
    "thirdPartyProvider": null,
    "thirdPartyTokenType": "jwt",
    "publishableKey": "<JWT>",
    "openfortURL": "http://localhost:7054"
  }
}
```

### confirmRecover (project entropy)
```json
{
  "uuid": "<uuid>",
  "recovery": {
    "auth": "custom",
    "token": "<JWT>",
    "authProvider": "authservice",
    "tokenType": "jwt",
    "encryptionSession": "<session_id> OR null"
  },
  "publishableKey": "<JWT>",
  "shieldAPIKey": "<shield_api_key>",
  "accessToken": "<JWT>",
  "playerID": "<userId>",
  "account": "<accountId>",
  "thirdPartyProvider": null,
  "thirdPartyTokenType": "jwt",
  "encryptionKey": null,
  "encryptionPart": "<shield_encryption_part> OR null",
  "encryptionSession": "<session_id> OR null",
  "passkey": null,
  "openfortURL": "http://localhost:7054",
  "shieldURL": "http://localhost:7053"
}
```

## Hot storage /v2/accounts response shape
```json
{
  "object": "list",
  "data": [
    { "id": "...", "address": "0x...", ... }
  ],
  "start": 0,
  "end": 0,
  "total": 1
}
```

## Iframe create/sign/recover response shapes (empirically observed)
### create result
```json
{
  "uuid": "<uuid>",
  "account": "<account-id-string>",
  "success": true,
  "deviceID": "...",
  "address": "0x..."   (appears after first 120 chars in log)
}
```
Key: `account` = account ID (not `accountId` or `id`); `address` = wallet address.

### sign result
```json
{
  "uuid": "<uuid>",
  "success": true,
  "signature": "0x..."
}
```
Signing uses EIP-191 (recoverMessageAddress with EIP-191 prefix) — verified in test 2.

### recover result
Similar to create; `address` field present but position may vary.
Recovery falls back to `existingAddress` from hot_storage if not in result.

## Encryption session approach
Preferred path attempted but Shield v0.5.2 restarts under test load (multiple consecutive test runs), invalidating in-memory sessions. Implemented automatic fallback:
1. `/api/shield/session` tries `POST /project/encryption-session` → returns `{session_id}` if Shield is healthy
2. If Shield is down or returns error → returns `{encryption_part}` directly (DEMO ONLY — custodial risk)
Client uses `encryptionSession` if `session_id` is returned, otherwise `encryptionPart`.

**DEMO ONLY label applies to encryptionPart fallback**: the server holds both `SHIELD_API_SECRET` and `SHIELD_ENCRYPTION_PART`, so the operator can reconstruct any user's key. In production, use a third-party custody model for the encryption part.

Fallback (encryptionPart direct) labeled as DEMO ONLY but not implemented in production path.

## Signing hashing scheme
(TBD — determined empirically by testing which viem recovery method matches)
Default assumption: EIP-191 (`recoverMessageAddress({ message, signature })`).

## Google OAuth credentials
Provided by user. Stored in `.env.google` (gitignored).
Client ID: 464560292107-gbvl15lrpe2ecdr74p6t11svpvm6rqo8.apps.googleusercontent.com
