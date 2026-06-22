import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { reloadNginx, testNginxConfig } from "@/server/system/nginx";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, fromError } from "@/lib/api-response";
import { z } from "zod";

const actionSchema = z.object({
  action: z.enum(["reload", "test"]),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = await req.json() as unknown;

    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) return badRequest("action must be 'reload' or 'test'");

    let result;
    if (parsed.data.action === "reload") {
      result = await reloadNginx();

      await prisma.auditLog.create({
        data: {
          userId: session.id,
          action: "RELOAD_NGINX",
          entity: "System",
          details: JSON.stringify({ success: result.success }),
        },
      });
    } else {
      result = await testNginxConfig();
    }

    return ok(result);
  } catch (e) {
    return fromError(e);
  }
}
