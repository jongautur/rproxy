#!/usr/bin/env bash
# Used by PM2 to start the Next.js app. Runs as the rproxy user.
cd /opt/rproxy/apps/web

# Sync the live default-page nginx config with Settings before serving
# traffic — see scripts/bootstrap-startup.ts. Non-fatal: the app should
# still come up even if this fails (e.g. DB not reachable yet).
node_modules/.bin/tsx scripts/bootstrap-startup.ts || true

exec node_modules/.bin/next start -p 81
