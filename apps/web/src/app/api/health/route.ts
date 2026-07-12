import { getSystemHealth } from "@/server/services/system-health.service";

export const dynamic = "force-dynamic";

// Unauthenticated by design (see PUBLIC_PATHS in middleware.ts) — this is
// meant for external monitoring/process supervisors, and only ever reports
// up/down per dependency, never error internals beyond a short detail string.
export async function GET() {
  const health = await getSystemHealth();
  return Response.json(health, { status: health.status === "ok" ? 200 : 503 });
}
