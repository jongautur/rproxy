import { requireSession } from "@/lib/auth";
import { runHealthSweep } from "@/server/services/health.service";
import { ok, fromError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Session-gated batch probe of every enabled proxy host in one request,
// used by the Hosts page on load/refresh. See runHealthSweep() for why this
// replaced N parallel calls to POST /api/proxies/[id]/health.
export async function POST() {
  try {
    await requireSession();
    const results = await runHealthSweep();
    return ok({ results });
  } catch (e) {
    return fromError(e);
  }
}
