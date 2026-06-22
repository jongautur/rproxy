#!/usr/bin/env bash
# setup.sh — Installs all system dependencies for rproxy on Debian/Ubuntu.
# Run as root (LXC/Proxmox install) or as a user with sudo privileges.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
RPROXY_USER="rproxy"
RPROXY_HOME="/home/rproxy"
NODE_VERSION="22"
PNPM_VERSION="9"
DB_NAME="rproxy"
DB_USER="rproxy"
APP_DIR="/opt/rproxy/apps/web"
ENV_FILE="${APP_DIR}/.env.local"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# Run a command as root: directly if already root, via sudo otherwise.
as_root() {
  if [[ $EUID -eq 0 ]]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Run a command as a specific user: runuser if root, sudo -u otherwise.
as_user() {
  local user="$1"; shift
  if [[ $EUID -eq 0 ]]; then
    runuser -u "$user" -- "$@"
  else
    sudo -u "$user" "$@"
  fi
}

info "=== rproxy system setup ==="

# ── 1. System packages ────────────────────────────────────────────────────────
info "Installing system packages..."
as_root apt-get update -qq
as_root apt-get install -y -qq \
  curl wget git build-essential ca-certificates \
  nginx libnginx-mod-stream openssl socat cron \
  postgresql postgresql-contrib \
  gnupg lsb-release sudo libcap2-bin
success "System packages installed"

# ── 2. Node.js 22 (system-wide via NodeSource) ────────────────────────────────
if ! node --version 2>/dev/null | grep -q "^v${NODE_VERSION}"; then
  info "Installing Node.js ${NODE_VERSION} via NodeSource..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | as_root bash -
  as_root apt-get install -y nodejs
  success "Node.js $(node --version) installed"
else
  success "Node.js $(node --version) already present"
fi

# Allow non-root processes to bind privileged ports (needed for port 81)
info "Setting cap_net_bind_service on node..."
as_root setcap cap_net_bind_service=+ep "$(which node)"
success "Port capability set"

# ── 3. pnpm + PM2 (global) ────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm ${PNPM_VERSION}..."
  as_root npm install -g "pnpm@${PNPM_VERSION}"
  success "pnpm $(pnpm --version) installed"
else
  success "pnpm $(pnpm --version) already present"
fi

if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  as_root npm install -g pm2
  success "PM2 installed"
else
  success "PM2 $(pm2 --version) already present"
fi

# ── 4. rproxy system user ─────────────────────────────────────────────────────
info "Creating rproxy system user..."
if ! id -u "$RPROXY_USER" &>/dev/null; then
  as_root useradd \
    --system \
    --create-home \
    --home-dir "$RPROXY_HOME" \
    --shell /bin/bash \
    --comment "rproxy service account" \
    "$RPROXY_USER"
  success "User '$RPROXY_USER' created (home: $RPROXY_HOME)"
else
  success "User '$RPROXY_USER' already exists"
fi

# ── 5. PostgreSQL ─────────────────────────────────────────────────────────────
info "Configuring PostgreSQL..."
as_root systemctl enable postgresql
as_root systemctl start postgresql

# Read existing password from .env.local when present so re-runs stay consistent.
if [[ -f "$ENV_FILE" ]]; then
  DB_PASS="$(sed -n 's|^DATABASE_URL="postgresql://rproxy:\([^@]*\)@.*|\1|p' "$ENV_FILE")"
  [[ -n "$DB_PASS" ]] || DB_PASS="$(openssl rand -hex 24)"
else
  DB_PASS="$(openssl rand -hex 24)"
fi

as_user postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 \
  && as_user postgres psql -c "ALTER USER ${DB_USER} WITH PASSWORD '${DB_PASS}';" \
  || as_user postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"

as_user postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  as_user postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

as_user postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
success "PostgreSQL ready"

# ── 6. .env.local ─────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  info "Writing .env.local..."
  as_root mkdir -p "$(dirname "$ENV_FILE")"
  JWT_SECRET="$(openssl rand -base64 64 | tr -d '\n')"
  JWT_REFRESH_SECRET="$(openssl rand -base64 64 | tr -d '\n')"
  CRON_SECRET="$(openssl rand -hex 32)"
  as_root tee "$ENV_FILE" > /dev/null <<ENVEOF
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
JWT_SECRET="${JWT_SECRET}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET}"
CRON_SECRET="${CRON_SECRET}"
NEXTAUTH_URL="http://localhost:81"
NODE_ENV="production"
ENVEOF
  as_root chmod 600 "$ENV_FILE"
  success ".env.local written"
else
  warn ".env.local already exists — skipping (delete to regenerate)"
  if ! grep -q '^CRON_SECRET=' "$ENV_FILE"; then
    echo "CRON_SECRET=\"$(openssl rand -hex 32)\"" | as_root tee -a "$ENV_FILE" > /dev/null
    success "CRON_SECRET appended"
  fi
fi

# ── 7. acme.sh (installed as rproxy user) ────────────────────────────────────
if [[ ! -f "${RPROXY_HOME}/.acme.sh/acme.sh" ]]; then
  info "Installing acme.sh for ${RPROXY_USER}..."
  as_user "$RPROXY_USER" bash -c '
    curl -fsSL https://get.acme.sh -o "$HOME/acme-install.sh"
    bash "$HOME/acme-install.sh" --install-online --nocron --noemail 2>&1 || true
    rm -f "$HOME/acme-install.sh"
  '
  [[ -f "${RPROXY_HOME}/.acme.sh/acme.sh" ]] \
    && success "acme.sh installed" \
    || warn "acme.sh install may need manual verification"
else
  success "acme.sh already present"
fi

# ── 8. Nginx ──────────────────────────────────────────────────────────────────
info "Configuring nginx..."
as_root mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
[[ -f /etc/nginx/sites-enabled/default ]] && as_root rm -f /etc/nginx/sites-enabled/default

# Catch-all server block: serves ACME HTTP challenges; proxy hosts add their own server_name blocks
as_root tee /etc/nginx/sites-available/acme-challenge > /dev/null << 'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        try_files $uri =404;
    }

    location / {
        return 444;
    }
}
NGINX
as_root ln -sf /etc/nginx/sites-available/acme-challenge /etc/nginx/sites-enabled/acme-challenge

as_root mkdir -p /etc/nginx/stream.d
as_root systemctl enable nginx
as_root nginx -t && as_root systemctl reload nginx
success "Nginx configured"

# ── 9. Sudoers ────────────────────────────────────────────────────────────────
info "Installing sudoers rules..."
as_root chmod +x /opt/rproxy/scripts/nginx-config-helper.sh
if as_root visudo -cf /opt/rproxy/sudoers/rproxy; then
  as_root cp /opt/rproxy/sudoers/rproxy /etc/sudoers.d/rproxy
  as_root chmod 440 /etc/sudoers.d/rproxy
  success "Sudoers rules installed"
else
  die "Sudoers file has errors — fix /opt/rproxy/sudoers/rproxy first"
fi

# ── 10. Directories and ownership ────────────────────────────────────────────
info "Setting up directories..."
as_root mkdir -p /var/lib/rproxy/staging /var/log/rproxy
as_root mkdir -p /var/www/html/.well-known/acme-challenge
as_root chown -R "${RPROXY_USER}:${RPROXY_USER}" \
  /var/lib/rproxy \
  /var/log/rproxy \
  /var/www/html/.well-known \
  /opt/rproxy
success "Directories ready"

# ── 11. PM2 startup (as rproxy) ───────────────────────────────────────────────
info "Registering PM2 startup service..."
as_root chmod +x /opt/rproxy/scripts/start-app.sh /opt/rproxy/scripts/install-app.sh
[[ -f /opt/rproxy/scripts/update-app.sh ]] && as_root chmod +x /opt/rproxy/scripts/update-app.sh
if [[ $EUID -eq 0 ]]; then
  as_root pm2 startup systemd -u "$RPROXY_USER" --hp "$RPROXY_HOME" >/dev/null
  success "PM2 startup registered"
else
  as_user "$RPROXY_USER" pm2 startup systemd -u "$RPROXY_USER" --hp "$RPROXY_HOME" 2>/dev/null \
    | grep 'sudo' | bash || true
  success "PM2 startup registered"
fi

# ── 12. Certificate renewal cron (rproxy user) ───────────────────────────────
info "Installing certificate renewal cron..."
as_root chmod +x /opt/rproxy/scripts/renew-certs.sh
CRON_JOB="0 3 * * * /opt/rproxy/scripts/renew-certs.sh >> /var/log/rproxy/renew-certs.log 2>&1"
( (as_user "$RPROXY_USER" crontab -l 2>/dev/null || true) | grep -v 'renew-certs.sh' || true; echo "$CRON_JOB" ) \
  | as_user "$RPROXY_USER" crontab -
success "Renewal cron installed (03:00 daily)"

# ── 13. Done ──────────────────────────────────────────────────────────────────
success ""
success "=== System setup complete! ==="
success ""
echo -e "  Next, run the app installer as the rproxy user:"
echo -e ""
echo -e "    sudo -u rproxy bash /opt/rproxy/scripts/install-app.sh"
echo -e ""
echo -e "  Default login: admin / admin   (port 81)"
echo ""
warn "Keep ${ENV_FILE} secure — it contains database credentials."
