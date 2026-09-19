# Installation & Operations

For the initial install walkthrough, see the root [README](../README.md#installation) — this document covers what happens under the hood and the things worth knowing once the app is already running.

## How the app actually runs

- The app runs as the dedicated `rproxy` system user under **PM2**, in fork mode, on port 81 — configured by `/opt/rproxy/ecosystem.config.js`, started via `/opt/rproxy/scripts/start-app.sh` (`next start -p 81`).
- PM2 is started under the `rproxy` user's own PM2 daemon — **not** whatever user you happen to be logged in as. `pm2 list` under a different user shows an empty table even if rproxy's instance is healthy. To manage it: `sudo -u rproxy pm2 <command>` (e.g. `restart rproxy`, `logs rproxy`, `describe rproxy`).
- Environment variables come from `/opt/rproxy/apps/web/.env.local` via **two separate mechanisms**: PM2's own `env_file` loading (baked into the process environment once, at the moment PM2 spawns/restarts the process) *and* Next.js's own internal dotenv loading (re-read from disk on every process start). Both need the file to be readable by `rproxy` — normally `chown rproxy:rproxy`, `chmod 600`.

  **This double-loading has a sharp edge**: if `.env.local`'s permissions get broken (e.g. accidentally reset to another user's ownership by an editor/IDE resaving it), Next's own load attempt fails loudly in the PM2 logs (`Failed to load env from .env.local [Error: EACCES...]`) on the next restart — but PM2's *previously cached* environment (from the last time the file *was* readable) keeps the process running on stale values, so existing secrets (`DATABASE_URL`, `JWT_SECRET`, etc.) silently keep working while anything **added or changed** in `.env.local` since that last good load never takes effect. The failure is visible in logs but not in app behavior, which makes it easy to miss. If you ever add a new environment variable and it doesn't seem to be picked up after a restart, check file ownership/permissions first: `stat -c '%U:%G %a' /opt/rproxy/apps/web/.env.local` should read `rproxy:rproxy 600`.

## Updating

```bash
sudo -u rproxy bash /opt/rproxy/scripts/update-app.sh
```

This does a `git pull --ff-only`, `pnpm install`, `prisma db push`, `pnpm build`, then `pm2 restart` — and waits up to 60 seconds for the app to respond on port 81 before exiting. Because it's a `git pull`, **it only picks up committed, pushed changes** — local uncommitted edits in the working tree are invisible to it. If you're iterating locally on the same box that's also serving production (a common setup for a single-server install), you can `pnpm build` directly in `apps/web` and `sudo -u rproxy pm2 restart rproxy` to deploy without going through git at all — but that means the running code and git history can drift, so reconcile them (commit) before you forget what's actually live.

If `scripts/nginx-config-helper.sh` changed in an update, `update-app.sh` prints a warning: the root-owned installed copy at `/usr/local/libexec/rproxy-nginx-helper` is **not** updated automatically (`rproxy` can't write to it, by design — see Security below). Re-run `sudo bash /opt/rproxy/scripts/setup.sh` as root to refresh it whenever that warning appears.

## Cron jobs

All installed by `setup.sh` into the `rproxy` user's crontab, each calling a `POST /api/cron/*` endpoint authenticated with `CRON_SECRET` (`Authorization: Bearer <secret>`), logging to `/var/log/rproxy/*.log`:

| Schedule | Script | What it does |
|---|---|---|
| Daily, 03:00 | `renew-certs.sh` | Renews certificates nearing expiry, **then also** triggers log cleanup (`/api/cron/cleanup-logs`) and traffic-stats log parsing (`/api/cron/parse-logs`) in the same run — despite the script's name, it does three things, not one. |
| Every 2 minutes | `health-check.sh` | Probes every enabled proxy host and fires host-down/host-up notifications. Exists so health checks keep running even when nobody has the Hosts page open in a browser (the page itself also probes on load). |
| Every 5 minutes | `ddns-check.sh` | Checks the server's public IP; if it changed, updates any Cloudflare DNS record pointing at the old one. No-ops quickly if DDNS isn't configured. |
| Every 5 minutes | `gateway-usage-flush.sh` | Drains the API Gateway's Redis-side usage counters into the persisted `ApiUsage` rollup Analytics reads, and updates `ApiKey.lastUsedAt`. |

Each wrapper script independently reads `CRON_SECRET` from `.env.local` on every run — same file-permission caveat as above applies here too. `CRON_SECRET` itself is generated once at install time (`openssl rand -hex 32`); rotating it in `.env.local` is sufficient on its own — no script changes needed, since every wrapper re-reads the file fresh each run.

The 03:00 job's fixed order (renew → clean up logs → parse logs) matters: if log cleanup has to truncate an active log file to stay under its configured size cap, any bytes not yet parsed at that point are lost before the parser ever sees them — see [System, Logs & Backups](09-system-logs-backup.md#log-retention).

## Environment variables

Beyond the ones `setup.sh` generates automatically (`DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `CRON_SECRET`, `NEXTAUTH_URL`, `REDIS_URL`, `GATEWAY_AUTH_SECRET`), these are optional and only needed for specific features:

| Variable | Needed for |
|---|---|
| `GATEWAY_REDIS_FAIL_OPEN` | API Gateway. `true` (default) lets customer traffic through unmetered if Redis is briefly unreachable; `false` fails closed. |
| `GATEWAY_SIGNUP_SECRET` | API Gateway self-signup endpoint (`POST /api/gateway/signup`). Unset = the endpoint rejects everything with 401. |
| `GATEWAY_SIGNUP_API_ID` | Required alongside `GATEWAY_SIGNUP_SECRET` — the one `Api` self-signup grants access to. |
| `GATEWAY_SIGNUP_BLOCKED_PATH_PREFIXES` | Optional, comma-separated path prefixes self-signup keys can never reach. Defaults to `/home`. |

`NEXTAUTH_URL` deserves a specific callout: it's not just a display value — the login cookie's `secure` flag is derived from whether `NEXTAUTH_URL` starts with `https://`, **not** from `NODE_ENV`. If you run rproxy behind plain HTTP (e.g. LAN-only, or behind a TLS-terminating proxy that talks HTTP to rproxy) and `NEXTAUTH_URL` is set to an `https://` URL that doesn't match reality, the login cookie will be marked `Secure` and browsers will silently refuse to send it back over HTTP — login will appear to succeed but the session won't persist. Set `NEXTAUTH_URL` to match how the app is actually reached.

## Security model (for anyone auditing or extending this)

- The app process (`rproxy` user) never writes to `/etc/nginx` directly and never runs an arbitrary shell command. Every privileged filesystem operation goes through `sudo /usr/local/libexec/rproxy-nginx-helper` — a **root-owned**, `rproxy`-non-writable copy of `scripts/nginx-config-helper.sh` — which does its own independent path/filename validation rather than trusting the app already validated.
- `sudoers/rproxy` pins the sudo rule to that specific installed path, never the in-checkout copy `rproxy` owns for git/pnpm purposes and never a wildcard — if `rproxy` could write the script it's allowed to run as root, that would be a full root escalation.
- Editing `scripts/nginx-config-helper.sh` in the repo has **no effect on a running instance** until an admin re-runs `setup.sh` as root — see the Updating section above.
- Every nginx config write (proxy, redirect, stream, access list, default page, API Gateway) goes through one transactional deploy path: stage → snapshot current state → write → test with `nginx -t` → reload only on success, otherwise atomically restore the pre-deploy snapshot. A failed config never goes live and never destroys the previous working one.
