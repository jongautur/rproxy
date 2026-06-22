#!/usr/bin/env bash
# install-app.sh — Run once after setup.sh to install deps, migrate DB, build, and start.
# Must be run as the rproxy user: sudo -u rproxy bash /opt/rproxy/scripts/install-app.sh

set -euo pipefail

APP_DIR="/opt/rproxy/apps/web"
ENV_FILE="${APP_DIR}/.env.local"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

[[ "$(whoami)" == "rproxy" ]] || die "Run as the rproxy user: sudo -u rproxy bash $0"
[[ -f "$ENV_FILE" ]] || die ".env.local not found — run setup.sh first"

command -v node  &>/dev/null || die "node not found — run setup.sh first"
command -v pnpm  &>/dev/null || die "pnpm not found — run setup.sh first"
command -v pm2   &>/dev/null || die "pm2 not found — run setup.sh first"

# ── Install dependencies ──────────────────────────────────────────────────────
info "Installing dependencies..."
cd "$APP_DIR"
pnpm install --frozen-lockfile
success "Dependencies installed"

# ── Database ──────────────────────────────────────────────────────────────────
info "Pushing database schema..."
set -a; source "$ENV_FILE"; set +a
pnpm run prisma:push
success "Schema pushed"

info "Seeding database..."
pnpm run prisma:seed
success "Database seeded (admin / admin)"

# ── Build ─────────────────────────────────────────────────────────────────────
info "Building application..."
pnpm build
success "Build complete"

# ── Start with PM2 ───────────────────────────────────────────────────────────
info "Starting with PM2..."
pm2 start /opt/rproxy/ecosystem.config.js
pm2 save
success "Application started"

echo ""
success "=== rproxy is running on port 81 ==="
echo -e "  Open: http://$(hostname -I | awk '{print $1}'):81"
echo -e "  Login: admin / admin"
echo -e "  Change the password in Settings immediately."
echo ""
