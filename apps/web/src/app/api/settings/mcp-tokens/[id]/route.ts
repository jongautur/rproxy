import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { getClientIp } from "@/lib/rate-limit";
import { revokeMcpToken } from "@/server/services/mcp-token.service";
import { ok, fromError } from "@/lib/api-response";

// Revoke, not hard-delete — the row stays so the token list and audit log
// still show what existed and when it was cut off.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    return ok({ token: await revokeMcpToken(session.id, id, getClientIp(req)) });
  } catch (e) {
    return fromError(e);
  }
}
