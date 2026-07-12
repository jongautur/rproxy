import { type NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createStream } from "@/server/services/stream.service";
import { ok, badRequest, conflict, fromError } from "@/lib/api-response";
import { checkSelfLoopPorts } from "@/lib/validation";
import { z } from "zod";

const schema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-zA-Z0-9 _-]+$/, "Name may only contain letters, numbers, spaces, _ and -"),
  protocol: z.enum(["TCP", "UDP", "TCP_UDP"]).default("TCP"),
  listenPort: z.number().int().min(1).max(65535),
  forwardHost: z.string().min(1).max(253),
  forwardPort: z.number().int().min(1).max(65535),
  accessListId: z.string().cuid().nullable().optional(),
});

export async function GET() {
  try {
    const session = await requireSession();
    void session;
    const items = await prisma.streamHost.findMany({ orderBy: { createdAt: "desc" } });
    return ok({ items });
  } catch (e) { return fromError(e); }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAdmin();
    const body = await req.json() as unknown;
    const parsed = schema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Invalid input");

    const loopError = checkSelfLoopPorts([parsed.data.listenPort]);
    if (loopError) return badRequest(loopError);

    const existing = await prisma.streamHost.findUnique({ where: { name: parsed.data.name } });
    if (existing) return conflict("A stream host with that name already exists");

    const { stream, deploy } = await createStream(parsed.data, session.id);
    return ok({ stream, nginxTest: deploy }, 201);
  } catch (e) { return fromError(e); }
}
