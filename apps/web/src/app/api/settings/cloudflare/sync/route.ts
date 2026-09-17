import { requireAdmin } from "@/lib/auth";
import { syncCloudflareRecords } from "@/server/services/proxy.service";
import { ok, fromError } from "@/lib/api-response";

export async function POST() {
  try {
    const session = await requireAdmin();
    const result = await syncCloudflareRecords(session.id);
    return ok(result);
  } catch (e) {
    return fromError(e);
  }
}
