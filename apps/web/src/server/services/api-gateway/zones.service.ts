import { prisma } from "@/lib/prisma";
import { generateRateLimitZonesConfig, ZONES_CONF_FILENAME } from "@/server/config-generator/api-gateway-zones-config";
import type { BatchEntry } from "@/server/services/nginx-deploy.service";

// Renders one `limit_req_zone` per enabled Api/ApiRoute that has a
// configured static safety limit (route override, falling back to the
// parent Api's default) — this is the coarse, non-customer-aware nginx
// backstop; true per-customer limiting is enforced separately via Redis in
// gateway-auth.service.ts. Returns a BatchEntry rather than deploying
// directly, so callers can bundle it into one deployConfigBatch() call
// alongside the Api site file that references these zone names — see
// api.service.ts for why that atomicity matters (Correction 6 in the API
// Gateway plan).
//
// `excludeApiId` lets a delete-in-progress compute the post-delete zone
// set even though the DB row hasn't been removed yet at the point this is
// called (api.service.ts's deleteApi() deploys the nginx-side removal
// before the DB delete, matching the rest of this service's "admin intent
// to remove shouldn't get stuck behind a broken nginx state" convention).
export async function buildZonesBatchEntry(excludeApiId?: string): Promise<BatchEntry> {
  const apis = await prisma.api.findMany({
    where: { enabled: true, ...(excludeApiId ? { id: { not: excludeApiId } } : {}) },
    include: { routes: { where: { enabled: true } } },
  });

  const config = generateRateLimitZonesConfig(apis);
  return { kind: "confd", filename: ZONES_CONF_FILENAME, config };
}
