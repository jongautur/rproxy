# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

rproxy — a self-hosted, Docker-free reverse proxy manager for Linux (Nginx Proxy Manager, without the Docker dependency). Next.js 15 (App Router) management UI backed by PostgreSQL/Prisma, driving nginx and acme.sh directly on the host. The monorepo root (`/opt/rproxy`) holds install/setup scripts and the privileged nginx helper; the app itself lives in `apps/web`.

## Commands

All app commands run from `apps/web`:

```bash
pnpm dev              # dev server on :3000
pnpm build             # production build
pnpm start              # production server on :81
pnpm typecheck          # tsc --noEmit
pnpm lint                # next lint
pnpm test                 # vitest run (unit + config-generator integration tests)
pnpm exec vitest run src/server/config-generator/__tests__/nginx-config.test.ts  # single file
npx prisma db push        # push schema changes (no migration files — see below)
npx prisma studio
```

CI (`.github/workflows/ci.yml`) runs shellcheck on `scripts/*.sh`, then prisma validate, typecheck, lint, test, and build. The config-generator integration test needs a real `nginx` binary (installed in CI) since it runs `nginx -t` against generated output.

Local dev needs `apps/web/.env.local` (copy from `.env.example`) pointing at a local Postgres and Redis, plus `JWT_SECRET`, `JWT_REFRESH_SECRET`, `NEXTAUTH_URL=http://localhost:3000`, `CRON_SECRET`, `GATEWAY_AUTH_SECRET` (see API Gateway below).

Production install/update flow is `scripts/setup.sh` (system deps, as sudo user) → `scripts/install-app.sh` (build+start, as `rproxy` user) → `scripts/update-app.sh` for subsequent updates. The app runs under PM2 as the dedicated `rproxy` system user, port 81.

## Architecture

### The privilege boundary is the core design constraint

The app process (running as the unprivileged `rproxy` user) never writes to `/etc/nginx` directly and never runs arbitrary shell. Every privileged operation goes through one path:

1. App code calls `safeExec()` / `nginxHelper()` in `apps/web/src/server/system/exec.ts`. This only allows `execFile` (never a shell) against a fixed `BINARY_ALLOWLIST` (`nginx`, `systemctl`, `sudo`, `openssl`), and rejects any argument containing shell metacharacters.
2. Nginx file operations go through `sudo /usr/local/libexec/rproxy-nginx-helper <cmd> <args>` — a root-owned, `rproxy`-non-writable copy of `scripts/nginx-config-helper.sh`. **Editing `scripts/nginx-config-helper.sh` in the repo has no effect on a running production instance** until an admin re-runs `setup.sh` as root to refresh the installed copy — the two can drift, and `update-app.sh` prints a warning when that file changed.
3. `sudoers/rproxy` pins the sudo rule to that installed path specifically (never a wildcard, never the in-checkout copy) — if `rproxy` could write the script it runs as root, that would be a root escalation.
4. The helper script itself does its own strict validation (path traversal, filename patterns, containment within allowed dirs) before touching the filesystem — never trust that the caller (the Next.js app) already validated.

When touching anything in this chain, preserve the boundary: no new privileged operation should bypass the allowlist/helper pattern, and no validation should move from the helper into the app (the helper must stay independently safe since it's the thing that actually runs as root).

### Transactional nginx deployment

`apps/web/src/server/services/nginx-deploy.service.ts` is the single deploy path for proxy/redirect site configs (`deploySiteConfig`) and stream configs: stage → snapshot current state → atomically write final path → symlink into `sites-enabled` (if applicable) → `nginx -t` → reload only on success, otherwise atomically restore the pre-deploy snapshot. Deploys are serialized through an in-process promise-chain lock (`withDeployLock`) — safe because the app runs as a single PM2 fork-mode instance, not because of any filesystem locking. Any new host type or config-writing feature should reuse this service rather than reimplementing write/test/reload/rollback. `deployConfigBatch()` extends the same transaction across *multiple* files (one `nginx -t`, one reload, all-or-nothing rollback) — needed by the API Gateway, where a site config and the shared `limit_req_zone` conf.d file must change together with no safe order for two separate deploys.

### Layout

- `apps/web/src/app/` — Next.js App Router: pages under feature dirs (`proxies/`, `certificates/`, `settings/`, `api-gateway/`, etc., each typically with a `components/` subdir) and API routes under `app/api/`. `app/(app)/` is the authenticated route group.
- `apps/web/src/app/api/cron/*` — endpoints hit by system cron (cert renewal, log cleanup, health checks, log parsing, DDNS check, API Gateway usage flush), guarded by `CRON_SECRET`.
- `apps/web/src/app/api/gateway/*` — the API Gateway's own CRUD/analytics routes, plus `auth-check/` (the internal `auth_request` target — see API Gateway below, not gated by `CRON_SECRET` or the session cookie).
- `apps/web/src/server/services/` — business logic: one service per domain concept (proxy, redirect, stream, certificate, access-list, health, notification, cloudflare, ddns, totp, real-ip, log-parser). API routes should stay thin and delegate here. `server/services/api-gateway/` holds the API Gateway's own services.
- `apps/web/src/server/config-generator/` — pure functions that render nginx config text from DB models (proxy/redirect/stream/default-server/real-ip/access-list/api-gateway). Kept separate from the services so config generation can be unit- and integration-tested (`nginx -t`) independent of I/O.
- `apps/web/src/server/system/` — the privilege boundary (`exec.ts`), plus `nginx.ts` (test/reload wrappers) and `acme.ts` (acme.sh invocation) and `metrics.ts` (host stats).
- `apps/web/src/lib/` — cross-cutting concerns: `auth.ts` / `jwt.ts` / `cookies.ts` (auth), `encrypt.ts` (AES-256-GCM for secrets at rest, key derived from `JWT_SECRET`), `rate-limit.ts`, `validation.ts` (zod schemas), `directive-presets.ts`, `redis.ts` (client singleton), `api-key.ts` (API Gateway key generation/hashing).

### Auth model

JWT access tokens (15 min) + refresh tokens (7 days), both HttpOnly cookies. Every user has a `tokenVersion`, embedded in the JWT and checked against the DB on each request — bumping it (on password/role change) invalidates all existing tokens immediately even though the JWT signature is still valid. Cookie `secure` flag is derived from `NEXTAUTH_URL` starting with `https://`, not from `NODE_ENV` — get this wrong and cookies silently stop being set over plain HTTP. Roles are `ADMIN` / `VIEWER` only.

### Database

No migration files — schema changes go through `prisma db push` in both dev and prod (`apps/web/prisma/schema.prisma` is the source of truth). Secrets stored in the DB (Cloudflare API tokens, DNS provider credentials, notification channel configs, TOTP secrets) are AES-256-GCM encrypted via `src/lib/encrypt.ts`; TOTP backup codes are bcrypt-hashed, not encrypted.

### Config generators are security-sensitive

Anything that ends up embedded in generated nginx config (domains, ports, custom directives, access-list rules) must be validated before it reaches a `config-generator/*.ts` function — these functions assume their input is already safe and just render it into config text that gets tested with `nginx -t` before going live, but `nginx -t` won't catch a value that's syntactically valid nginx but semantically wrong (e.g. a directive that alters a context it shouldn't). Custom raw nginx directives (`customServer`/`customLocations`/`customHeaders` on `ProxyHost`) are deliberately restricted: braces are rejected outright (can't close/open a context) and a keyword blocklist filters dangerous directives (`lua`, `include`, `load_module`).

### API Gateway

A second, separate proxying surface alongside Proxy Hosts, for admins who want to expose specific backend routes to external customers under hashed API keys rather than a plain open reverse proxy. Own top-level nav item (`/api-gateway`), own model family, own nginx config generator — deliberately not layered onto `ProxyHost`.

**Data model:** `Api` (a domain + optional base path — the "site") → `ApiRoute` (a path + HTTP method set + its own upstream target; one route = one location block = one upstream, no per-method upstream splitting) → `Customer` → `ApiKey` (belongs to a customer) → `ApiAccess` (the actual grant: a customer may call an Api at all, plus default rate limit/quota) → optionally `ApiRouteAccess` (per-customer override of one route's limits) and `ApiKeyRouteScope` (per-key restriction to a route, and within it a specific method subset — both opt-in, unset means "inherit full customer-level access").

**API keys:** generated as `rpk_<prefix>_<secret>` (`lib/api-key.ts`); only the SHA-256 hash and the non-secret prefix are ever stored — the plaintext is returned once, at generation time, and is unrecoverable after that. Never bcrypt here: bcrypt's deliberate slowness defends low-entropy human-chosen secrets against offline brute force, but these are high-entropy generated secrets checked on every proxied request, where bcrypt's cost would also cap throughput and can't be used as a DB index anyway.

**Request flow:** nginx's `auth_request` directive (wired per-route in `api-gateway-config.ts`, only for routes with `authRequired`) calls an internal, `internal;`-only nginx location proxying to `POST /api/gateway/auth-check` (`gateway-auth.service.ts#checkAccess`) — authenticated by a shared secret (`GATEWAY_AUTH_SECRET`, `X-Gateway-Internal-Secret` header, `timingSafeEqual`, same pattern as the cron routes) plus the presented API key. `checkAccess` hashes the key, validates it against Postgres (key/customer enabled, `ApiAccess` grant, `ApiRouteAccess`/`ApiKeyRouteScope` overrides, method sub-scope), then checks Redis for per-customer rate/quota. `auth_request` only understands 2xx/401/403 from the subrequest — a bare 429 would NOT propagate — so a rate/quota denial is returned as 403 with an `X-Gateway-Deny-Reason` header, remapped to a real client-visible 429 by a named nginx error location (`@gw_403` in `api-gateway-config.ts`). This is covered by a real end-to-end test (`api-gateway-auth-integration.test.ts`) that runs actual nginx against a stub auth server — don't assume the remap works without it, verify against real nginx.

**Rate limiting has two independent layers, not one:** nginx's own `limit_req` (via a shared `limit_req_zone` conf.d file, `zones.service.ts` + `api-gateway-zones-config.ts`) is a static, non-customer-aware safety ceiling per route — it protects the backend regardless of caller and doesn't depend on the app or Redis. True per-customer rate limits and daily/monthly quotas are enforced separately in `gateway-auth.service.ts` via Redis, keyed by **`customerId`, never `apiKeyId`** — a customer's multiple keys share one allowance. If Redis is briefly unreachable, `GATEWAY_REDIS_FAIL_OPEN` (default `true`) lets customer traffic through unmetered rather than taking every API offline; the static nginx ceiling still applies either way. Usage (allowed/denied/throttled counts) and `ApiKey.lastUsedAt` are tallied in Redis only, never written to Postgres per-request — a cron (`usage-flush.service.ts`, every 5 min) atomically claims and drains those counters into the persisted `ApiUsage` rollup that the Analytics tab reads. Analytics is scoped to what the gateway itself observes (allowed/denied/throttled, quota utilization) — `auth_request` runs before `proxy_pass`, so it has no visibility into the real backend's response status or latency; that would need nginx access-log parsing on the Gateway's own sites (not implemented).

**Deploying a route's config always uses `deployConfigBatch`** (site file + the shared zones file together, one `nginx -t`, one reload) rather than `deploySiteConfig` alone — a route's rate limit can add or remove a `limit_req_zone` name the site references, and there's no safe order for two separate deploys.
