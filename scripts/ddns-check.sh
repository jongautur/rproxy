#!/usr/bin/env bash
# ddns-check.sh — Called every 5 minutes by cron to check the server's public
# IP and, if it changed, update any Cloudflare A record that was pointing at
# the old IP. No-ops quickly if DDNS isn't enabled or the IP hasn't changed.
# Reads CRON_SECRET from .env.local and calls the ddns-check API.

set -euo pipefail

ENV_FILE="/opt/rproxy/apps/web/.env.local"
API_URL="http://localhost:81/api/cron/ddns-check"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[ddns-check] ERROR: $ENV_FILE not found" >&2
  exit 1
fi

CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")"

if [[ -z "$CRON_SECRET" ]]; then
  echo "[ddns-check] ERROR: CRON_SECRET not found in $ENV_FILE" >&2
  exit 1
fi

HTTP_STATUS=$(curl -s -o /tmp/ddns-check-output.json -w "%{http_code}" \
  -X POST "$API_URL" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json")

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "[ddns-check] $(date '+%Y-%m-%d %H:%M:%S') OK — $(cat /tmp/ddns-check-output.json)"
else
  echo "[ddns-check] $(date '+%Y-%m-%d %H:%M:%S') ERROR — HTTP $HTTP_STATUS: $(cat /tmp/ddns-check-output.json)" >&2
  exit 1
fi
