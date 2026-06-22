import { requireSession } from "@/lib/auth";
import { getSystemInfo } from "@/server/system/metrics";
import { getNginxStatus } from "@/server/system/nginx";
import { ok, fromError } from "@/lib/api-response";

export async function GET() {
  try {
    await requireSession();
    const [system, nginx] = await Promise.all([
      getSystemInfo(),
      getNginxStatus(),
    ]);
    return ok({ system, nginx });
  } catch (e) {
    return fromError(e);
  }
}
