# Production Readiness Roadmap

This document describes the gaps between the current POC and a production-grade deployment. Items are grouped by category and ordered roughly by priority within each section.

---

## 1. Remove the custodial risk — the most important change

This is the most significant architectural issue. The same operator currently controls both the hot share (`hot_storage`) and the cold share (Shield), which means they can reconstruct any user's private key unilaterally.

```
Current (custodial):
  Operator controls hot_storage  →  hot share  ✓
  Operator controls Shield       →  cold share ✓
                                    ─────────────
                                    full key reconstructable
```

There are two paths out of this, and they can be combined:

### Option A — Independent cold share custodian

Run Shield with a genuinely separate operator: different organisation, different infrastructure, different access keys. The `hot_storage` operator can never obtain cold shares without breaching a separate party. This is the institutional custody model (similar to how Fireblocks operates).

### Option B — User-controlled recovery key

Use OpenSigner's built-in recovery methods so the user holds the encryption key for their cold share, not the operator:

- **Password recovery** — `recoveryMethod: "password"`. The user's password encrypts the cold share. The operator never holds the decryption key.
- **Passkey recovery** — `setRecoveryMethod` with WebAuthn PRF. The user's hardware key (Touch ID, YubiKey) derives the encryption key. Phishing-resistant and device-bound.

The tradeoff: if the user loses both their device share and their recovery credential, the key is unrecoverable. Make recovery setup mandatory in the onboarding UX, not optional.

**Recommended**: Option B (passkey) for consumer apps; Option A for institutional / B2B.

---

## 2. Transport and infrastructure security

### TLS everywhere

Nothing else in this list matters much without this.

- Set `BETTER_AUTH_BASE_URL` to an `https://` URL. better-auth checks the scheme and automatically sets the `Secure` flag on session cookies. Without HTTPS the cookies are sent in plaintext.
- Enable `DB_SSLMODE=require` for all three services. The dev overlay disables TLS; production must not apply it.
- Terminate TLS at a reverse proxy (nginx, Cloudflare, AWS ALB) in front of all services.
- If a reverse proxy sits in front of `auth_service`, set `TRUST_PROXY=true` so rate limiting keys on the real client IP rather than the proxy's address.

### Remove `?debug=true` from the iframe URL

The iframe's debug flag logs share operations to the browser console. Remove it in production:

```
# web/.env.local (production)
NEXT_PUBLIC_IFRAME_URL=https://your-iframe-host/index.html
```

### Separate databases

All three services (auth, hot_storage, Shield) share one Postgres instance in this demo. In production:

- Run separate Postgres instances per service, or at minimum separate databases with separate credentials and no cross-service access.
- A bug or SQL injection in one service's queries cannot corrupt another service's data.
- Enables independent scaling and backup schedules.

### Secrets management

`JWT_SECRET`, `SHARE_ENCRYPTION_KEY`, `SHIELD_API_SECRET`, and `SHIELD_ENCRYPTION_PART` are stored in flat `.env` files. In production use a secrets manager:

- **AWS Secrets Manager** or **Parameter Store**
- **HashiCorp Vault**
- **GCP Secret Manager** / **Azure Key Vault**

Inject secrets into containers at runtime; never bake them into images or commit them to version control.

---

## 3. Authentication hardening

| Item | Detail |
|---|---|
| **Secure cookies** | Automatic once `BETTER_AUTH_BASE_URL` is `https://` — better-auth derives the `Secure` flag from the scheme |
| **Email verification** | Currently disabled. Enable `emailVerification` in better-auth if users register with email/password |
| **Passkey login** | better-auth supports WebAuthn natively. Adds phishing-resistant login without a password |
| **Session and JWT lifetimes** | Review better-auth defaults for your threat model. Short-lived JWTs reduce the window for token replay |
| **Rate limiting** | `auth_service` has per-route rate limits configured; verify they are appropriate for your expected traffic |
| **Remove dev email login** | The `NEXT_PUBLIC_DEV_EMAIL_LOGIN` flag exposes a username/password form. Ensure it is not set in production builds |

---

## 4. Resolve the open TODOs in key creation

In `lib/signer.ts`, the `create` call passes two placeholder values:

```typescript
userEntropy: "TODO",
projectEntropy: "TODO",
```

These fields are passed directly to the OpenSigner iframe. Their effect on key derivation is not documented in the open-source repo. Before shipping:

- Determine whether these fields influence the derived private key or are purely metadata.
- If they influence the key, changing them after wallet creation would produce a different address — coordinate any change carefully.
- If they are metadata only, replace `"TODO"` with meaningful values (e.g. a user ID hash and a project identifier).

---

## 5. ERC-4337 transaction layer

| Item | Detail |
|---|---|
| **Paid bundler** | The Pimlico free tier has rate limits. Production traffic needs a paid plan or a self-hosted bundler (e.g. [Alto](https://github.com/pimlicoHQ/alto)) |
| **Nexus / EntryPoint v0.7** | The demo uses Nexus 1.3.3 (MEE suite 2.2.3) with the MEE K1 validator and EntryPoint v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`). Pin deployment parameters and assess module installation controls before enabling extensions. Existing SimpleAccount assets require a separate migration. |
| **Paymaster policy** | The current verifying paymaster sponsors all transactions unconditionally. Production needs policy: per-user gas limits, allowlisted target contracts, expiry, abuse detection |
| **Multi-chain** | Verify Nexus factory, validator and EntryPoint deployments on each target chain; configure chain-specific public RPC, bundler/paymaster and UI state. Do not assume every EVM chain has matching deployments |
| **Raw signing** | The OpenSigner iframe signs with EIP-191 and does not expose a raw `secp256k1` signing mode. EOA transactions (non-ERC-4337 chains, pre-ERC-4337 flows) are not possible without an iframe build that supports raw signing |

---

## 6. Operational readiness

### Monitoring and alerting

- Aggregate logs from all Docker services (ELK, Datadog, CloudWatch).
- Alert on: elevated auth failure rate, failed UserOps, Shield or hot_storage errors, JWT verification failures.
- Instrument the Next.js app with error tracking (Sentry or similar).

### Key rotation

There is currently no process for rotating secrets without downtime:

- **`JWT_SECRET` rotation** — both the old and new secret must be accepted simultaneously during rollover (better-auth supports multiple secrets for this). Coordinate with the JWT lifetimes so old tokens expire naturally.
- **`SHARE_ENCRYPTION_KEY` rotation** — requires re-encrypting all hot shares with the new key. Hot_storage would need a migration script.
- **Shield `encryption_part` rotation** — Shield has a `/project/rotate-encryption-key` endpoint for this.

### Backup and disaster recovery

- Automated Postgres backups with tested restore procedures. If the database is lost, all wallets are unrecoverable.
- Document the recovery time objective (RTO) and recovery point objective (RPO).
- Test restoration into a staging environment regularly.

### Account recovery UX

If a user loses their device share and has no recovery method configured, their funds are permanently inaccessible. In the current demo, recovery setup is optional. In production:

- Make password or passkey recovery setup a **required** step during wallet creation.
- Remind users to verify their recovery method works before they hold significant value.
- Consider a time-locked social recovery option for high-value accounts.

---

## 7. Compliance considerations

Depending on jurisdiction and use case, holding encrypted key material on behalf of users may require specific licensing (e.g. custodial wallet provider, VASP registration under AMLD5/MiCA in the EU, or state money transmitter licences in the US). Legal review is needed before a public launch.

---

## Priority order

| Priority | Item |
|---|---|
| 1 | TLS + secure cookies — nothing else is safe without this |
| 2 | Independent cold share custodian or user-controlled recovery — removes custodial risk |
| 3 | Separate databases + secrets manager — reduces blast radius |
| 4 | Resolve `userEntropy` / `projectEntropy` TODOs — correctness risk |
| 5 | Paid bundler + paymaster policy — reliability and cost control |
| 6 | Key rotation procedures — operational hygiene |
| 7 | Monitoring, backup, and disaster recovery — survivability |
| 8 | Compliance review — legal requirement before public launch |
