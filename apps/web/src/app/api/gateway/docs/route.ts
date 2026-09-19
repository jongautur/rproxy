import { requireSession } from "@/lib/auth";
import { listDocsSummaries } from "@/server/services/api-gateway/docs.service";
import { ok, fromError } from "@/lib/api-response";

export async function GET() {
  try {
    await requireSession();
    const summaries = await listDocsSummaries();
    return ok(summaries);
  } catch (e) {
    return fromError(e);
  }
}
