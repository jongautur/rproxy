# rproxy

A self-hosted, Docker-free reverse proxy manager for Linux — built on Nginx, Let's Encrypt, and a Next.js management UI.

Think Nginx Proxy Manager, but without the Docker dependency.

![rproxy logo](apps/web/public/logo.png)

---

## Features

- **Proxy hosts** — point domains at upstream services with a few clicks
- **SSL certificates** — automatic Let's Encrypt issuance & renewal via acme.sh (HTTP and DNS challenges)
- **Access lists** — IP allow/deny rules and HTTP basic auth per proxy host
- **Logs** — live log streaming from nginx
- **System dashboard** — nginx status, CPU, memory, disk, health checks
- **Multi-user** — ADMIN and VIEWER roles
- **Audit log** — every action is recorded

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
- A user with `sudo` access
- Internet access (for Let's Encrypt, NodeSource, acme.sh install)

---

## Installation

### 1. Clone the repo

```bash
git clone https://github.com/your-org/rproxy.git /opt/rproxy
```

### 2. Run system setup (as a sudo user)

```bash
bash /opt/rproxy/scripts/setup.sh
```

This installs nginx, Node.js 22, PostgreSQL, PM2, acme.sh, sets up the `rproxy` system user, generates secrets, and configures sudoers.

### 3. Build and start the app (as the rproxy user)

```bash
sudo -u rproxy bash /opt/rproxy/scripts/install-app.sh
```

### 4. Open the UI

Navigate to `http://<your-server-ip>:81`

**Default credentials:** `admin` / `admin`
You will be forced to change the password on first login.

---

## Key paths

| Path | Purpose |
|------|---------|
| `/opt/rproxy/apps/web` | Next.js application |
| `/opt/rproxy/apps/web/.env.local` | Secrets (DATABASE_URL, JWT secrets) — mode 600 |
| `/opt/rproxy/scripts/` | Setup, install, helper scripts |
| `/etc/nginx/sites-available/` | Generated nginx configs |
| `/etc/nginx/ssl/` | Certificate files |
| `/etc/nginx/access-lists/` | htpasswd files |
| `/var/log/nginx/` | nginx access & error logs |
| `/var/log/rproxy/` | App logs |
| `/var/lib/rproxy/staging/` | Config staging area (written by app, deployed by helper) |
| `/home/rproxy/.acme.sh/` | acme.sh installation |

---

## Architecture

The app runs as a dedicated `rproxy` system user. nginx config is managed through a strictly validated helper script (`scripts/nginx-config-helper.sh`) called via sudo — the app user never writes directly to `/etc/nginx`. All binary execution uses an allowlist; no shell metacharacters are permitted in arguments.

---

## Security notes

- JWT access tokens expire in 15 minutes; refresh tokens in 7 days — both in HttpOnly cookies
- Passwords are hashed with bcrypt (cost 12)
- DNS provider API credentials are encrypted at rest (AES-256-GCM, key derived from JWT_SECRET)
- Custom nginx directives are filtered for dangerous keywords (lua, `include`, `load_module`)
- The `rproxy` user has only the minimum sudo permissions needed (see `sudoers/rproxy`)
- Default `admin / admin` password must be changed on first login (enforced)

---

## Development

```bash
cd apps/web
cp .env.example .env.local   # fill in values
pnpm install
pnpm dev
```

---

## License

MIT — see [LICENSE](LICENSE).
