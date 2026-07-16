#!/usr/bin/env bash
# health-check.sh — Called every 2 minutes by cron to probe every enabled
# proxy host, independent of anyone having the Hosts page open. Without this,
# host_down/host_up notifications only fire when a browser tab is actively
# viewing the Hosts page (that page's own load-triggered probe).
# Reads CRON_SECRET from .env.local and calls the health-check API.

set -euo pipefail

ENV_FILE="/opt/rproxy/apps/web/.env.local"
API_URL="http://localhost:81/api/cron/health-check"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[health-check] ERROR: $ENV_FILE not found" >&2
  exit 1
fi

CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")"

if [[ -z "$CRON_SECRET" ]]; then
  echo "[health-check] ERROR: CRON_SECRET not found in $ENV_FILE" >&2
  exit 1
fi

HTTP_STATUS=$(curl -s -o /tmp/health-check-output.json -w "%{http_code}" \
  -X POST "$API_URL" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json")

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "[health-check] $(date '+%Y-%m-%d %H:%M:%S') OK — $(cat /tmp/health-check-output.json)"
else
  echo "[health-check] $(date '+%Y-%m-%d %H:%M:%S') ERROR — HTTP $HTTP_STATUS: $(cat /tmp/health-check-output.json)" >&2
  exit 1
fi
