#!/usr/bin/env bash
# gateway-usage-flush.sh — Called periodically by cron to drain the API
# Gateway's Redis-side usage/lastUsed counters (written on the request path
# by gateway-auth.service.ts) into the persisted ApiUsage rollup and
# ApiKey.lastUsedAt — see usage-flush.service.ts. Reads CRON_SECRET from
# .env.local and calls the flush API, same pattern as health-check.sh.

set -euo pipefail

ENV_FILE="/opt/rproxy/apps/web/.env.local"
API_URL="http://localhost:81/api/cron/gateway-usage-flush"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[gateway-usage-flush] ERROR: $ENV_FILE not found" >&2
  exit 1
fi

CRON_SECRET="$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d'=' -f2- | tr -d '"' | tr -d "'")"

if [[ -z "$CRON_SECRET" ]]; then
  echo "[gateway-usage-flush] ERROR: CRON_SECRET not found in $ENV_FILE" >&2
  exit 1
fi

HTTP_STATUS=$(curl -s -o /tmp/gateway-usage-flush-output.json -w "%{http_code}" \
  -X POST "$API_URL" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json")

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "[gateway-usage-flush] $(date '+%Y-%m-%d %H:%M:%S') OK — $(cat /tmp/gateway-usage-flush-output.json)"
else
  echo "[gateway-usage-flush] $(date '+%Y-%m-%d %H:%M:%S') ERROR — HTTP $HTTP_STATUS: $(cat /tmp/gateway-usage-flush-output.json)" >&2
  exit 1
fi
