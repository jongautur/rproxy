# Changelog

All notable changes to rproxy are documented here.

## [Unreleased]

## [1.0.0] — 2026-06-22

### Added
- **Stream Hosts** — TCP and UDP proxying via the nginx `stream` module. Configure port-forwarding rules (e.g. Minecraft, SSH, database) directly from the UI with protocol selection (TCP / UDP / TCP+UDP), forward host, and listen port.
- Stream host table with protocol badge, enable/disable toggle, edit and delete.
- `stream-deploy`, `stream-remove`, and `mkdir-stream` commands in the nginx config helper.
- `stream {}` block in `/etc/nginx/nginx.conf` with `include /etc/nginx/stream.d/*.conf`.

### Fixed
- Install `libnginx-mod-stream` in `setup.sh` — the stream module is dynamic on standard Ubuntu nginx builds and must be installed separately; without it nginx silently rejects the `stream {}` block and no ports open.

## [0.8.0] — 2026-06-22

### Added
- **Two-Factor Authentication (TOTP)** — RFC 6238 compliant, implemented with pure Node.js `crypto` (no external TOTP runtime). No third-party services involved at any point.
- QR code rendered server-side as SVG using the `qrcode` package — zero external image requests.
- TOTP secret encrypted at rest with AES-256-GCM.
- 8 single-use backup codes (bcrypt-hashed) generated on TOTP setup.
- `/mfa` page for the two-step login flow.
- `POST /api/auth/mfa` endpoint — verifies TOTP code or backup code, issues real session tokens.
- `GET/POST/DELETE /api/settings/totp` — setup, enable, and disable TOTP.
- TOTP setup card in Settings → Security with inline QR display, manual key reveal, and backup code grid.
- `mfaPending` JWT claim to gate the MFA step between login and full session.
- **Force password change on first login** — seed admin is created with `mustChangePassword: true`; middleware redirects to `/change-password` until the password is updated and fresh tokens are issued.

## [0.7.0] — 2026-06-22

### Added
- **Traffic Stats dashboard card** — 24-hour request count, bandwidth, error rate, and top 5 hosts by traffic. Populated by the existing access-log cron job.
- **Notifications** — email (SMTP) and webhook channels. Configurable per-event (host down, host recovery, certificate expiring, certificate renewal failed). Includes a test-send button and per-channel enable toggle.
- Health check transitions now fire notifications on DOWN/UP state changes.
- Certificate service fires `cert_expiring` (≤14 days) and `cert_renewal_failed` notifications.

## [0.6.0] — 2026-06-22

### Added
- **Redirect Hosts** — HTTP/HTTPS redirects managed through nginx, with configurable target URL, HTTP status code (301/302/307/308), and optional SSL.
- **Custom certificate upload** — bring your own cert/key pair instead of using ACME.
- Redirect host table with status badge, enable/disable toggle, edit and delete.
- TLS support in redirect config generator.

## [0.5.0] — 2026-06-22

### Changed
- Roadmap formalised through v1.0.0.

## [0.1.0] — 2026-06-22

### Added
- Initial release — native Linux reverse proxy manager built on Next.js 15, nginx, PostgreSQL, and Prisma.
- Proxy host management: create, edit, delete, enable/disable with live nginx config generation and reload.
- SSL/TLS via ACME (Let's Encrypt) with automatic renewal cron.
- WebSocket, HTTP/2, and force-HTTPS options per proxy host.
- Health monitoring with per-host UP/DOWN probing and history.
- Dashboard with expiring certificate warnings.
- Domain grouping toggle on the proxy hosts table — groups subdomains under their root domain with expand/collapse.
- User management with role-based access (admin/user).
- JWT authentication with 15-minute access tokens and 7-day refresh tokens (HttpOnly cookies). Middleware transparently refreshes the session so users stay logged in for the full 7 days without re-authenticating.
- Settings: profile, password change, notification channels, security (2FA).
- Privileged nginx config helper script (`nginx-config-helper.sh`) called via `sudo` — the app process never runs as root.
- `setup.sh` for one-command server provisioning.
