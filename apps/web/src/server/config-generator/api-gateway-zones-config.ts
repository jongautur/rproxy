import type { Api, ApiRoute } from "@prisma/client";

// Shared global conf.d snippet — limit_req_zone must be declared once at
// the http level, not per-server, so this can't live inside a per-Api site
// file the way the rest of the API Gateway config does (see
// api-gateway-config.ts). Deployed via the generalized deployConfDConfig()
// in nginx-deploy.service.ts, alongside the "rproxy-real-ip.conf" this
// mechanism already handled — see the ALLOWED_CONFD_FILES allowlist in
// scripts/nginx-config-helper.sh.
export const ZONES_CONF_FILENAME = "rproxy-apigw-zones.conf";

// nginx zone names must be valid identifiers — route/api ids are cuids
// (already alphanumeric), but this is still defense in depth against
// whatever ends up in that column.
function sanitizeZoneName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, "");
}

export function zoneNameForRoute(routeId: string): string {
  return `gwz_${sanitizeZoneName(routeId)}`;
}

// Distinct "gwzd_" prefix from zoneNameForRoute's "gwz_" so a route id and
// an Api id can never collide into the same zone name.
export function zoneNameForDocs(apiId: string): string {
  return `gwzd_${sanitizeZoneName(apiId)}`;
}

// A flat default — burst tuning isn't exposed in the V1 schema. Chosen to
// absorb a short traffic spike without materially weakening the ceiling
// this zone exists to enforce.
const DEFAULT_BURST = 10;

// The public developer portal (api-gateway-config.ts's docs-proxy locations)
// has no per-customer concept — it's reachable by anyone before any API key
// exists — so unlike route zones there's no admin-configurable rate to fall
// back to. This is just a safety ceiling against it becoming an unthrottled
// path to the shared app process (Node singleton also serving the admin
// dashboard), not a tuned limit, so a flat default is enough.
const DOCS_DEFAULT_RATE_PER_SECOND = 20;

type ApiWithRoutes = Api & { routes: ApiRoute[] };

export function generateRateLimitZonesConfig(apis: ApiWithRoutes[]): string {
  const lines: string[] = [];

  for (const api of apis) {
    for (const route of api.routes) {
      const rate = route.maxRequestsPerSecond ?? api.maxRequestsPerSecond;
      if (!rate) continue; // no static safety limit configured for this route
      const zoneName = zoneNameForRoute(route.id);
      lines.push(`limit_req_zone $binary_remote_addr zone=${zoneName}:10m rate=${rate}r/s;`);
    }
    if (api.docsEnabled && api.docsPublic && api.docsSlug) {
      const zoneName = zoneNameForDocs(api.id);
      lines.push(`limit_req_zone $binary_remote_addr zone=${zoneName}:10m rate=${DOCS_DEFAULT_RATE_PER_SECOND}r/s;`);
    }
  }

  return lines.join("\n");
}

export { DEFAULT_BURST };
