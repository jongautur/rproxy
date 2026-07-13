#!/usr/bin/env bash
# update-app.sh — Pull latest code, migrate schema, rebuild, and restart.
# Run as the rproxy user: sudo -u rproxy bash /opt/rproxy/scripts/update-app.sh

set -euo pipefail

APP_ROOT="/opt/rproxy"
APP_DIR="/opt/rproxy/apps/web"
ENV_FILE="${APP_DIR}/.env.local"

[[ "$(whoami)" == "rproxy" ]] || {
  echo "Run as rproxy: sudo -u rproxy bash /opt/rproxy/scripts/update-app.sh" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || { echo ".env.local not found at ${ENV_FILE}" >&2; exit 1; }

cd "$APP_ROOT"
[[ -d .git ]] || {
  echo "Cannot update: ${APP_ROOT} is not a git checkout." >&2
  echo "Install rproxy with git clone, or replace this updater with a release-tarball updater." >&2
  exit 1
}

OLD_HEAD="$(git rev-parse HEAD)"
git fetch --tags origin
git pull --ff-only
NEW_HEAD="$(git rev-parse HEAD)"

if ! git diff --quiet "$OLD_HEAD" "$NEW_HEAD" -- scripts/nginx-config-helper.sh; then
  echo "WARNING: scripts/nginx-config-helper.sh changed in this update." >&2
  echo "         The root-owned copy at /usr/local/libexec/rproxy-nginx-helper is" >&2
  echo "         NOT updated automatically (rproxy cannot write to it). Run" >&2
  echo "         'sudo bash $APP_ROOT/scripts/setup.sh' as root to refresh it." >&2
fi

cd "$APP_DIR"
# See install-app.sh — lower concurrency avoids OOM-killing the install on
# small VPS/LXC boxes when several large native binaries download/extract
# in parallel.
pnpm install --frozen-lockfile --network-concurrency=4

set -a; source "$ENV_FILE"; set +a
pnpm run prisma:push

pnpm build

if [[ "${RPROXY_SKIP_RESTART:-0}" == "1" ]]; then
  echo "Update complete."
  exit 0
fi

# Restart via PM2 if running; systemd restart is handled externally by the caller.
if command -v pm2 &>/dev/null && pm2 describe rproxy &>/dev/null 2>&1; then
  pm2 restart rproxy
  pm2 save
fi

for _ in {1..60}; do
  if curl -fs -o /dev/null http://127.0.0.1:81; then
    echo "rproxy is responding on port 81."
    echo "Update complete."
    exit 0
  fi
  sleep 1
done

echo "Update finished, but rproxy did not respond on port 81 within 60 seconds." >&2
exit 1
