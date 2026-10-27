import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { mcpTokenCreateSchema } from "@/lib/validation";
import { getClientIp } from "@/lib/rate-limit";
import { createMcpToken, listMcpTokens } from "@/server/services/mcp-token.service";
import { ok, created, badRequest, forbidden, fromError } from "@/lib/api-response";

// Each user manages only their own MCP tokens — a token always acts as the
// user who created it (see the McpToken schema comment).

export async function GET() {
  try {
    const session = await requireSession();
    return ok({ items: await listMcpTokens(session.id) });
  } catch (e) {
    return fromError(e);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const body = await req.json() as unknown;

    const parsed = mcpTokenCreateSchema.safeParse(body);
    if (!parsed.success) return badRequest("Validation failed", parsed.error.flatten().fieldErrors);
    if (parsed.data.scope === "WRITE" && session.role !== "ADMIN") {
      return forbidden("Only admins can create write tokens");
    }

    const { token, plaintext } = await createMcpToken(session, parsed.data, getClientIp(req));
    // The plaintext is returned exactly once, here — only its hash is stored.
    return created({ token, plaintext });
  } catch (e) {
    return fromError(e);
  }
}
