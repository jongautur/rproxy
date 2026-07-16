# Changelog

All notable changes to rproxy are documented here.

## [Unreleased]

## [1.1.0] — 2026-07-16

### Added
- **Easy mode for custom directives** — the Advanced tab's Custom Location/Server Directives fields now default to a guided row builder (pick a directive from a curated dropdown, fill in its value) instead of raw text. An Easy/Advanced switch lets you drop into the free-text editor when you need something outside the curated list; lines the builder doesn't recognize are preserved rather than dropped.
- **Search on the Hosts page** — filter Proxy Hosts by domain or forward host, matching the search UI already used on Certificates. Wired to the `search` query param `/api/proxies` already supported server-side.
- Redirect and stream hosts can now attach an access list, same as proxy hosts (streams get IP allow/deny only, since raw TCP/UDP has no HTTP layer for Basic Auth).
- Self-loop guard: proxy/stream listen ports are rejected if they collide with the port the rproxy app itself is bound to.
- Configurable default page and custom 403 page (Settings → Nginx).
- Automatic cert renewal and log cleanup are now logged to the audit trail as system actions.
- `/api/health` readiness endpoint, CSRF/origin validation and request body size limits in middleware, login/MFA rate limiting, audit log retention, a vitest unit/integration test suite, and a CI workflow (shellcheck, typecheck, lint, tests, prisma validate, build).

### Fixed
- Disabled/removed sites no longer leak traffic to an unrelated backend over HTTPS.
- The default page no longer silently drops connections until Settings is saved.
- `acme.sh` install no longer fails with a garbled "Unknown parameter" error.
- `setup.sh` now succeeds on a genuinely fresh box.
- Auth-only access lists were locked out by a hidden default; access lists with zero rules now fail closed with an explicit allow/deny default instead of always appending "deny all".
- Blocked custom-directive keywords now return a 400 instead of a 500.
- The nginx config helper's path check no longer breaks remove/disable on every site.
- TOTP QR code now renders with an intrinsic size.
- CSRF origin check no longer rejects all logins on a self-hosted `next start` deployment.
- Stale proxy/redirect/stream edit dialogs no longer silently clear `accessListId` (or, for redirects, drop it entirely) on save.
- Closed the sudo-helper root-escalation path (root-owned helper copy outside the app's writable checkout), removed a log-viewer stored-XSS vector, made nginx deploys transactional with automatic rollback, fixed cert renewal treating exec failures as success, and hardened cert upload file permissions.
- Session role/existence is now re-validated against the DB every request instead of trusting cached JWT claims; fixed middleware route matching (prefix match → exact match) and log-parser traffic-stat loss across log rotation.
- Proxy, redirect, certificate, and stream tables now collapse secondary columns on mobile instead of overflowing.

### Docs
- Documented the 1GB RAM / 2-core minimum, confirmed by a real OOM kill on a smaller box.

## [1.0.0] — 2026-06-22

### Added
- **Stream Hosts** — TCP and UDP proxying via the nginx `stream` module. Configure port-forwarding rules (e.g. Minecraft, SSH, database) with protocol selection (TCP / UDP / TCP+UDP), listen port, and forward host:port.
- Stream host table with protocol badge, enable/disable toggle, edit and delete.
- `stream-deploy`, `stream-remove`, and `mkdir-stream` commands in the nginx config helper script.
- `stream {}` block in `/etc/nginx/nginx.conf` with `include /etc/nginx/stream.d/*.conf`.

### Fixed
- Install `libnginx-mod-stream` in `setup.sh` — the stream module is dynamic on standard Ubuntu nginx builds and must be installed separately; without it nginx silently rejects the `stream {}` block and no ports open.
- Middleware now attempts session refresh even when the access token cookie has been deleted by the browser (after its 15-minute `maxAge`), not only when an expired token is present. This prevented users from being redirected to `/login` after the cookie expired despite having a valid 7-day refresh token.

## [0.8.0] — 2026-06-22

### Added
- **Two-Factor Authentication (TOTP)** — RFC 6238 compliant, implemented with pure Node.js `crypto` (no external TOTP runtime or image services).
- QR code rendered server-side as an SVG string via the `qrcode` package — displayed inline, no external requests.
- TOTP secret encrypted at rest with AES-256-GCM.
- 8 single-use backup codes (bcrypt-hashed) generated at TOTP setup, shown once in a copyable grid.
- `/mfa` page for the two-step login flow — accepts 6-digit TOTP or 8-character backup code.
- `POST /api/auth/mfa` — verifies code, issues full session tokens.
- `GET/POST/DELETE /api/settings/totp` — setup flow, enable, and disable endpoints.
- TOTP card in Settings → Security: inline QR display, manual key reveal/copy, backup code grid.
- `mfaPending` JWT claim gates the MFA step between credential login and full session.
- **Force password change on first login** — seed admin is created with `mustChangePassword: true`. Middleware redirects to `/change-password` until updated; fresh tokens are issued immediately so no re-login is needed.
- `/change-password` page with current password verification.

### Fixed
- Session refresh cookie `path` corrected from `/api/auth` to `/` — browsers were not sending the refresh token on page navigations, causing premature logouts.
- Middleware now silently refreshes the access token on both API routes and page routes when the access token is expired, so the 7-day refresh token is fully utilised.

## [0.7.0] — 2026-06-22

### Added
- **Traffic Stats card** on the dashboard — 24-hour request count, total bandwidth, error rate (highlighted red above 5%), and top 5 hosts by traffic. Data is populated by the access-log cron job.
- **Notifications** — email (SMTP) and webhook delivery channels. Per-channel enable toggle and test-send button. Fires on: host down, host recovery, certificate expiring (≤14 days), certificate renewal failed.
- Health check service detects DOWN/UP transitions and calls `fireNotification()`.
- Certificate service fires `cert_expiring` and `cert_renewal_failed` events.

## [0.6.0] — 2026-06-22

### Added
- **Redirect Hosts** — HTTP/HTTPS redirects managed via nginx, with configurable target URL, HTTP status code (301/302/307/308), and optional SSL/TLS.
- **Custom certificate upload** — supply your own cert/key pair as an alternative to ACME.
- Redirect host table with status badge, enable/disable toggle, edit and delete.

## [0.5.0] — 2026-06-22

### Changed
- Internal roadmap formalised through v1.0.0.

## [0.1.0] — 2026-06-22

### Added
- **Proxy Hosts** — create, edit, delete, enable/disable reverse proxy entries. Live nginx config generation and reload on every change. Options per host: SSL/TLS (ACME), WebSocket, HTTP/2, force HTTPS.
- Domain grouping toggle on the proxy table — collapses subdomains under their root domain with expand/collapse per group.
- **SSL/TLS certificates** — issue via ACME (Let's Encrypt / ZeroSSL) with automatic renewal cron, or upload custom cert/key pairs. Certificate table with expiry dates and manual renewal trigger.
- **Access Lists** — IP-based allow/deny rules and HTTP basic-auth (htpasswd) lists, attachable to proxy hosts. Full CRUD with search.
- **Log Viewer** — real-time nginx log streaming via Server-Sent Events. Switch between log files, pause/resume stream, search/filter lines, syntax-highlighted status codes (2xx/3xx/4xx/5xx), download raw log.
- **Activity Log** — paginated audit trail of all create/update/delete/login actions across the app, with action-type badges, search, and user filter.
- **System page** — live CPU, RAM, and disk usage gauges; nginx status with start/stop/reload controls; uptime and last-reload timestamp.
- **Multi-user support** — admin can create, edit, and delete users from Settings → Users. Roles: `ADMIN` (full access) and `VIEWER` (read-only).
- **Dashboard** — host count, certificate health, expiring-cert warnings, recent activity feed, nginx status card, and traffic stats.
- **Health monitoring** — per-proxy-host UP/DOWN probing with response-time display, stored history, and notification hooks.
- JWT authentication — 15-minute access tokens + 7-day refresh tokens in `HttpOnly` cookies. Middleware transparently refreshes sessions; users stay logged in for the full 7 days.
- Settings: profile edit, password change, notification channels, security (TOTP).
- Backup and config export via `/api/system/backup` and `/api/system/export`.
- Privileged nginx config helper (`nginx-config-helper.sh`) called via `sudo` with strict argument validation — the app process never runs as root.
- `setup.sh` for one-command server provisioning (Node.js, PostgreSQL, nginx, PM2, rproxy user, sudoers entry).
