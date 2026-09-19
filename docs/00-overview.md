# rproxy — Documentation

rproxy is a self-hosted, Docker-free reverse proxy manager for Linux — nginx and acme.sh driven directly on the host, managed through a Next.js web UI backed by PostgreSQL. Think Nginx Proxy Manager, without the Docker dependency.

This directory documents what the app does and how to operate it. For installing it in the first place, start with the root [README](../README.md); this documentation assumes it's already running.

## What's here

| Doc | Covers |
|---|---|
| [Proxy Hosts](01-proxy-hosts.md) | Point domains at backend services — the core feature. |
| [Redirects & Streams](02-redirects-and-streams.md) | 301/302 redirect hosts, and raw TCP/UDP proxying. |
| [Access Lists](03-access-lists.md) | IP allow/deny rules and HTTP Basic Auth, reusable across hosts. |
| [Default Page & Error Pages](04-default-page-and-error-pages.md) | What unmatched domains/IPs see, and a custom 403 page. |
| [Certificates](05-certificates.md) | Let's Encrypt issuance (HTTP/DNS challenge), uploading your own, auto-renewal, Cloudflare DNS automation. |
| [API Gateway](06-api-gateway.md) | A separate, key-authenticated proxying surface with per-customer rate limits/quotas, analytics, a public docs portal, and a self-signup endpoint. |
| [Auth, Users & Audit Log](07-auth-users-mfa.md) | Login, sessions, roles, MFA/TOTP, and the activity log. |
| [Notifications & Integrations](08-notifications-cloudflare-ddns.md) | Alert channels, the Cloudflare integration, and Dynamic DNS. |
| [System, Logs & Backups](09-system-logs-backup.md) | The system dashboard, health checks, log viewing/retention, and backup/export. |
| [Installation & Operations](10-installation-and-operations.md) | How the app actually runs day to day, updating, cron jobs, environment variables, and the security model. |

## Who can do what

Two roles: **Admin** (full read/write) and **Viewer** (read-only everywhere, plus self-service password/MFA changes). See [Auth, Users & Audit Log](07-auth-users-mfa.md) for the exact boundary.

## Things that need a manual decision or external setup

These aren't bugs — they're points where the app deliberately waits for you rather than guessing:

- **DNS**: point each domain at your server (automatic only for Proxy Hosts if Cloudflare Auto-DNS is configured — see [Notifications & Integrations](08-notifications-cloudflare-ddns.md)).
- **Firewall**: open whatever ports each host actually needs — see the relevant doc per host type.
- **Default admin password**: must be changed on first login (enforced).
- **MFA recovery**: no admin-side reset exists yet — plan for how you'd recover a locked-out user before enabling MFA broadly (see [Auth, Users & Audit Log](07-auth-users-mfa.md)).
- **Certificate DNS-01 providers**: only Cloudflare, AWS Route53, GoDaddy, DigitalOcean, and OVH currently have credential fields in the UI — see [Certificates](05-certificates.md).
- **API Gateway self-signup**: off by default (returns 401 to everything) until you set `GATEWAY_SIGNUP_SECRET`/`GATEWAY_SIGNUP_API_ID` — see [API Gateway](06-api-gateway.md).
