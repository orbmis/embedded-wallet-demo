.PHONY: setup up down nuke bootstrap dev test e2e logs patch

COMPOSE_BASE := docker compose \
  --project-directory vendor/opensigner \
  --env-file .env.combined \
  -f vendor/opensigner/docker-compose.yml \
  -f vendor/opensigner/docker-compose.dev.yml \
  -f infra/compose.app.yml

# Locate the highest nvm-managed Node ≥22 and prepend its bin/ to PATH so that
# pnpm/npx/node all resolve to the right version even when the shell's active
# node is older (e.g. v20 from the system default).
_NODE22_BIN := $(shell ls -d $(HOME)/.nvm/versions/node/v2[2-9]*/bin 2>/dev/null | sort -V | tail -1)
ifneq ($(_NODE22_BIN),)
  export PATH := $(_NODE22_BIN):$(PATH)
endif

# ── setup: generate secrets, apply patch ─────────────────────────────────────
setup: .env.combined patch
	@echo "setup: done"

.env.opensigner:
	bash scripts/gen-secrets.sh .env.opensigner

.env.combined: .env.opensigner
	cat .env.opensigner $(wildcard .env.google) > .env.combined

# ── patch: apply Google social-login patch to auth_service ───────────────────
# $(CURDIR) is used because git -C changes the working directory, so a bare
# relative path like patches/auth-google.patch would resolve inside vendor/opensigner.
patch:
	@if git -C vendor/opensigner apply --check $(CURDIR)/patches/auth-google.patch 2>/dev/null; then \
	  git -C vendor/opensigner apply $(CURDIR)/patches/auth-google.patch && echo "patch: applied"; \
	elif git -C vendor/opensigner apply --check --reverse $(CURDIR)/patches/auth-google.patch 2>/dev/null; then \
	  echo "patch: already applied"; \
	else \
	  echo "patch: conflict — patch may need refreshing" >&2; exit 1; \
	fi

# ── up: start all services ────────────────────────────────────────────────────
up: .env.combined
	$(COMPOSE_BASE) up -d --build postgres auth_service iframe iframe-sample hot_storage cold_storage
	@echo "Waiting for health checks..."
	@timeout 120 bash -c 'until curl -sf http://localhost:7052/health >/dev/null; do sleep 2; done' && echo "auth_service: ok"
	@timeout 120 bash -c 'until curl -sf http://localhost:7054/health >/dev/null; do sleep 2; done' && echo "hot_storage: ok"

# ── down: stop services, keep volumes ────────────────────────────────────────
down:
	$(COMPOSE_BASE) down

# ── nuke: WARNING — destroys all data volumes ─────────────────────────────────
nuke:
	@echo "WARNING: this will destroy all postgres data. Press Ctrl-C to cancel, Enter to continue."
	@read _
	$(COMPOSE_BASE) down -v

# ── bootstrap: create Shield project + write web/.env.local ──────────────────
bootstrap:
	@node --version | grep -qE 'v2[2-9]\.' || (echo "bootstrap requires Node ≥22; install via: nvm install 22" >&2; exit 1)
	pnpm --dir web install 2>/dev/null || true
	npx tsx scripts/bootstrap-shield.ts

# ── dev: start Next.js on :7060 ───────────────────────────────────────────────
dev:
	@lsof -ti:7060 | xargs kill 2>/dev/null || true
	pnpm --dir web dev

# ── test: unit tests ──────────────────────────────────────────────────────────
test:
	pnpm --dir web test

# ── e2e: Playwright tests ─────────────────────────────────────────────────────
e2e:
	pnpm --dir web exec playwright test

# ── logs: tail all service logs ───────────────────────────────────────────────
logs:
	$(COMPOSE_BASE) logs -f
