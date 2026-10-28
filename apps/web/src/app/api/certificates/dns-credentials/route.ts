import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { hasSavedDnsCredentials } from "@/server/system/acme";
import { ok, badRequest, fromError } from "@/lib/api-response";

// Whether acme.sh has saved credentials for a DNS provider, so the issue
// dialog can offer to reuse them. Only ever returns a boolean, never values.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const provider = new URL(req.url).searchParams.get("provider") ?? "";
    if (!/^dns_[a-z0-9]+$/.test(provider)) return badRequest("Invalid provider");

    return ok({ saved: await hasSavedDnsCredentials(provider) });
  } catch (e) {
    return fromError(e);
  }
}
