import { NextRequest } from "next/server";
import { clearAuthCookies } from "@/lib/cookies";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, fromError } from "@/lib/api-response";

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();

    if (session) {
      await prisma.auditLog.create({
        data: {
          userId: session.id,
          action: "LOGOUT",
          entity: "User",
          entityId: session.id,
          ipAddress: req.headers.get("x-forwarded-for") ?? "unknown",
        },
      });
    }

    await clearAuthCookies();
    return ok({ message: "Logged out successfully" });
  } catch (e) {
    return fromError(e);
  }
}
