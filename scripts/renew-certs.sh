#!/usr/bin/env bash
# renew-certs.sh — Called daily by cron to trigger SSL certificate renewal.
# Reads CRON_SECRET from .env.local and calls the renewal API.

set -euo pipefail

ENV_FILE="/opt/rproxy/apps/web/.env.local"
API_URL="http://localhost:81/api/cron/renew-certs"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[renew-certs] ERROR: $ENV_FILE not found" >&2
  exit 1
fi

# Extract CRON_SECRET from .env.local
CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")"

if [[ -z "$CRON_SECRET" ]]; then
  echo "[renew-certs] ERROR: CRON_SECRET not found in $ENV_FILE" >&2
  exit 1
fi

echo "[renew-certs] $(date '+%Y-%m-%d %H:%M:%S') — running renewal check"

HTTP_STATUS=$(curl -s -o /tmp/renew-certs-output.json -w "%{http_code}" \
  -X POST "$API_URL" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json")

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "[renew-certs] OK — $(cat /tmp/renew-certs-output.json)"
else
  echo "[renew-certs] ERROR — HTTP $HTTP_STATUS: $(cat /tmp/renew-certs-output.json)" >&2
  exit 1
fi

echo "[cleanup-logs] $(date '+%Y-%m-%d %H:%M:%S') — running log cleanup"
curl -s -o /dev/null -w "[cleanup-logs] HTTP %{http_code}\n" \
  -X POST "http://localhost:81/api/cron/cleanup-logs" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json"

echo "[parse-logs] $(date '+%Y-%m-%d %H:%M:%S') — parsing traffic stats"
curl -s -o /dev/null -w "[parse-logs] HTTP %{http_code}\n" \
  -X POST "http://localhost:81/api/cron/parse-logs" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json"
