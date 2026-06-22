#!/usr/bin/env bash
# setup.sh — Installs all system dependencies for rproxy on Debian/Ubuntu.
# Run as a user with sudo privileges: bash /opt/rproxy/scripts/setup.sh

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

[[ $EUID -eq 0 ]] && die "Do not run as root. Run as a user with sudo access."

info "=== rproxy system setup ==="

# ── 1. System packages ────────────────────────────────────────────────────────
info "Installing system packages..."
sudo apt-get update -qq
sudo apt-get install -y -qq \
  curl wget git build-essential ca-certificates \
  nginx libnginx-mod-stream openssl socat cron \
  postgresql postgresql-contrib \
  gnupg lsb-release
success "System packages installed"

# ── 2. Node.js 22 (system-wide via NodeSource) ────────────────────────────────
if ! node --version 2>/dev/null | grep -q "^v${NODE_VERSION}"; then
  info "Installing Node.js ${NODE_VERSION} via NodeSource..."
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | sudo -E bash -
  sudo apt-get install -y nodejs
  success "Node.js $(node --version) installed"
else
  success "Node.js $(node --version) already present"
fi

# Allow non-root processes to bind privileged ports (needed for port 81)
info "Setting cap_net_bind_service on node..."
sudo setcap cap_net_bind_service=+ep "$(which node)"
success "Port capability set"

# ── 3. pnpm + PM2 (global) ────────────────────────────────────────────────────
if ! command -v pnpm &>/dev/null; then
  info "Installing pnpm ${PNPM_VERSION}..."
  sudo npm install -g "pnpm@${PNPM_VERSION}"
  success "pnpm $(pnpm --version) installed"
else
  success "pnpm $(pnpm --version) already present"
fi

if ! command -v pm2 &>/dev/null; then
  info "Installing PM2..."
  sudo npm install -g pm2
  success "PM2 installed"
else
  success "PM2 $(pm2 --version) already present"
fi

# ── 4. rproxy system user ─────────────────────────────────────────────────────
info "Creating rproxy system user..."
if ! id -u "$RPROXY_USER" &>/dev/null; then
  sudo useradd \
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
sudo systemctl enable postgresql
sudo systemctl start postgresql

DB_PASS="$(openssl rand -hex 24)"

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';"

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};"
success "PostgreSQL ready"

# ── 6. .env.local ─────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  info "Writing .env.local..."
  sudo mkdir -p "$(dirname "$ENV_FILE")"
  JWT_SECRET="$(openssl rand -base64 64 | tr -d '\n')"
  JWT_REFRESH_SECRET="$(openssl rand -base64 64 | tr -d '\n')"
  CRON_SECRET="$(openssl rand -hex 32)"
  sudo tee "$ENV_FILE" > /dev/null <<ENVEOF
DATABASE_URL="postgresql://${DB_USER}:${DB_PASS}@localhost:5432/${DB_NAME}"
JWT_SECRET="${JWT_SECRET}"
JWT_REFRESH_SECRET="${JWT_REFRESH_SECRET}"
CRON_SECRET="${CRON_SECRET}"
NEXTAUTH_URL="http://localhost:81"
NODE_ENV="production"
ENVEOF
  sudo chmod 600 "$ENV_FILE"
  success ".env.local written"
else
  warn ".env.local already exists — skipping (delete to regenerate)"
  if ! grep -q '^CRON_SECRET=' "$ENV_FILE"; then
    echo "CRON_SECRET=\"$(openssl rand -hex 32)\"" | sudo tee -a "$ENV_FILE" > /dev/null
    success "CRON_SECRET appended"
  fi
fi

# ── 7. acme.sh (installed as rproxy user) ────────────────────────────────────
if [[ ! -f "${RPROXY_HOME}/.acme.sh/acme.sh" ]]; then
  info "Installing acme.sh for ${RPROXY_USER}..."
  sudo -u "$RPROXY_USER" bash -c '
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
sudo mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
[[ -f /etc/nginx/sites-enabled/default ]] && sudo rm -f /etc/nginx/sites-enabled/default

# Catch-all server block: serves ACME HTTP challenges; proxy hosts add their own server_name blocks
sudo tee /etc/nginx/sites-available/acme-challenge > /dev/null << 'NGINX'
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
sudo ln -sf /etc/nginx/sites-available/acme-challenge /etc/nginx/sites-enabled/acme-challenge

sudo mkdir -p /etc/nginx/stream.d
sudo systemctl enable nginx
sudo nginx -t && sudo systemctl reload nginx
success "Nginx configured"

# ── 9. Sudoers ────────────────────────────────────────────────────────────────
info "Installing sudoers rules..."
chmod +x /opt/rproxy/scripts/nginx-config-helper.sh
if sudo visudo -cf /opt/rproxy/sudoers/rproxy; then
  sudo cp /opt/rproxy/sudoers/rproxy /etc/sudoers.d/rproxy
  sudo chmod 440 /etc/sudoers.d/rproxy
  success "Sudoers rules installed"
else
  die "Sudoers file has errors — fix /opt/rproxy/sudoers/rproxy first"
fi

# ── 10. Directories and ownership ────────────────────────────────────────────
info "Setting up directories..."
sudo mkdir -p /var/lib/rproxy/staging /var/log/rproxy
sudo mkdir -p /var/www/html/.well-known/acme-challenge
sudo chown -R "${RPROXY_USER}:${RPROXY_USER}" \
  /var/lib/rproxy \
  /var/log/rproxy \
  /var/www/html/.well-known \
  /opt/rproxy
success "Directories ready"

# ── 11. PM2 startup (as rproxy) ───────────────────────────────────────────────
info "Registering PM2 startup service..."
sudo chmod +x /opt/rproxy/scripts/start-app.sh /opt/rproxy/scripts/install-app.sh
sudo -u "$RPROXY_USER" pm2 startup systemd -u "$RPROXY_USER" --hp "$RPROXY_HOME" 2>/dev/null \
  | grep 'sudo' | bash || true
success "PM2 startup registered"

# ── 12. Certificate renewal cron (rproxy user) ───────────────────────────────
info "Installing certificate renewal cron..."
sudo chmod +x /opt/rproxy/scripts/renew-certs.sh
CRON_JOB="0 3 * * * /opt/rproxy/scripts/renew-certs.sh >> /var/log/rproxy/renew-certs.log 2>&1"
( sudo crontab -u "$RPROXY_USER" -l 2>/dev/null | grep -v 'renew-certs.sh'; echo "$CRON_JOB" ) \
  | sudo crontab -u "$RPROXY_USER" -
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
