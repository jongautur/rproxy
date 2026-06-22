#!/usr/bin/env bash
# Used by PM2 to start the Next.js app. Runs as the rproxy user.
cd /opt/rproxy/apps/web
exec node_modules/.bin/next start -p 81
