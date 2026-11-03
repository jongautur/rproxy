import { requireAdmin } from "@/lib/auth";
import { ok, fromError } from "@/lib/api-response";
import { syncLocalDns } from "@/server/services/local-dns.service";

export async function POST() {
  try {
    await requireAdmin();
    return ok(await syncLocalDns());
  } catch (e) { return fromError(e); }
}
