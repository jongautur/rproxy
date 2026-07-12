# rproxy

A self-hosted, Docker-free reverse proxy manager for Linux — built on nginx, Let's Encrypt, and a Next.js management UI.

Think Nginx Proxy Manager, but without the Docker dependency.

![rproxy logo](apps/web/public/logo.png)

---

## Features

- **Proxy hosts** — point domains at upstream services with a few clicks
- **Redirects** — 301/302 redirect hosts, with optional path preservation
- **Stream hosts** — raw TCP/UDP proxying (databases, SSH, game servers, mail, etc.)
- **SSL certificates** — automatic Let's Encrypt issuance & renewal via acme.sh (HTTP and DNS challenges)
- **Access lists** — IP allow/deny rules and HTTP basic auth, attachable to proxy, redirect, and stream hosts (streams get IP rules only — no HTTP layer for basic auth)
- **Default page** — control what unmatched domains / raw IP hits get: the stock nginx page, a redirect, custom HTML, or a closed connection
- **Custom error pages** — replace nginx's stock 403 (e.g. from an access-list denial) with your own HTML
- **Logs** — live log streaming from nginx
- **System dashboard** — nginx status, CPU, memory, disk, health checks
- **Multi-user** — ADMIN and VIEWER roles
- **Audit log** — every action is recorded, including automated actions (cert renewal, log cleanup) as "system"

---

## Stack

| Layer | Technology |
|-------|-----------|
| Web UI | Next.js 15 (App Router) + TypeScript + Tailwind CSS + shadcn/ui |
| Database | PostgreSQL + Prisma ORM |
| Reverse proxy | nginx |
| TLS | acme.sh (Let's Encrypt) |
| Process manager | PM2 |
| Runtime | Node.js 22 |

---

## Requirements

- Ubuntu 22.04 / Debian 12 (or similar)
- A non-root user with `sudo` access
- Internet access (for Let's Encrypt, NodeSource, acme.sh)

---

## Installation

### 1. Clone the repo

```bash
sudo apt-get install -y git   # if git isn't installed yet
git clone https://github.com/jongautur/rproxy.git /opt/rproxy
```

### 2. Run system setup

Run as your sudo user (not root):

```bash
bash /opt/rproxy/scripts/setup.sh
```

This will:
- Install nginx, Node.js 22, PostgreSQL, PM2, acme.sh
- Create the `rproxy` system user
- Set up the PostgreSQL database and generate a random password
- Write `/opt/rproxy/apps/web/.env.local` with all secrets (mode 600)
- Configure sudoers and a daily certificate renewal cron job

### 3. Build and start the app

```bash
sudo -u rproxy bash /opt/rproxy/scripts/install-app.sh
```

This installs dependencies, pushes the database schema, seeds the default admin account, builds the app, and starts it under PM2.

### 4. Open the UI

```
http://<your-server-ip>:81
```

**Default credentials:** `admin` / `admin`
You will be forced to set a new password on first login.

---

## Updating

```bash
sudo -u rproxy bash /opt/rproxy/scripts/update-app.sh
```

This pulls the latest code, installs dependencies, pushes any schema changes, rebuilds, restarts under PM2, and waits for the app to respond before exiting. If `scripts/nginx-config-helper.sh` changed in the update, it prints a warning — the root-owned installed copy at `/usr/local/libexec/rproxy-nginx-helper` isn't updated automatically, since `rproxy` can't write to it. Re-run `sudo bash /opt/rproxy/scripts/setup.sh` when that happens.

---

## Key paths

| Path | Purpose |
|------|---------|
| `/opt/rproxy/apps/web` | Next.js application |
| `/opt/rproxy/apps/web/.env.local` | Secrets (DATABASE_URL, JWT secrets) — mode 600 |
| `/opt/rproxy/scripts/` | Setup, install, helper scripts |
| `/etc/nginx/sites-available/` | Generated nginx configs (proxy hosts, redirects, the default-page catch-all) |
| `/etc/nginx/stream.d/` | Generated stream (TCP/UDP) configs |
| `/etc/nginx/ssl/` | Certificate files |
| `/etc/nginx/access-lists/` | htpasswd files |
| `/var/log/nginx/` | nginx access & error logs |
| `/var/log/rproxy/` | App logs |
| `/var/lib/rproxy/staging/` | Config staging area (written by app, deployed by helper) |
| `/var/lib/rproxy/pages/` | Static HTML for the default page and custom 403 page |
| `/home/rproxy/.acme.sh/` | acme.sh installation |

---

## Architecture

The app runs as a dedicated `rproxy` system user. nginx config is managed through a strictly validated helper script (`scripts/nginx-config-helper.sh`) called via sudo — the app user never writes directly to `/etc/nginx`. All binary execution uses an allowlist; no shell metacharacters are permitted in arguments.

Every config deploy is transactional: the previous config is backed up, the new one is staged and tested with `nginx -t`, and only reloaded on success — a failed test or reload automatically restores the previous working config instead of leaving a broken or half-applied state live.

---

## Security notes

- JWT access tokens expire in 15 minutes; refresh tokens in 7 days — both in HttpOnly cookies
- A `tokenVersion` on each user is checked on every request; changing a password or role immediately invalidates that user's existing tokens
- CSRF protection: state-changing requests are rejected unless their `Origin` matches the request's `Host` header
- Rate limiting on login and MFA attempts, per-IP and per-account
- Passwords are hashed with bcrypt (cost 12)
- DNS provider API credentials are encrypted at rest (AES-256-GCM, key derived from JWT_SECRET)
- Custom nginx directives are filtered for dangerous keywords (lua, `include`, `load_module`) and reject braces outright, so a directive can't close the current context and open a new one
- The `rproxy` user has only the minimum sudo permissions needed (see `sudoers/rproxy`), scoped to a root-owned helper script installed outside the app's writable checkout
- Default `admin / admin` password must be changed on first login (enforced by the app)

---

## Development

You'll need a local PostgreSQL instance. Then:

```bash
cd apps/web
cp .env.example .env.local
# Edit .env.local:
#   DATABASE_URL — point at your local Postgres
#   JWT_SECRET / JWT_REFRESH_SECRET — any long random strings
#   NEXTAUTH_URL — http://localhost:3000
#   CRON_SECRET — any string
pnpm install
npx prisma db push
npx prisma db seed
pnpm dev
```

The dev server runs on port 3000.

---

## License

MIT — see [LICENSE](LICENSE).
