import { type NextRequest } from "next/server";
import { requireAdmin, requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { updateStream, deleteStream, toggleStream } from "@/server/services/stream.service";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";
import { checkSelfLoopPorts } from "@/lib/validation";
import { z } from "zod";

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  protocol: z.enum(["TCP", "UDP", "TCP_UDP"]).optional(),
  listenPort: z.number().int().min(1).max(65535).optional(),
  forwardHost: z.string().min(1).max(253).optional(),
  forwardPort: z.number().int().min(1).max(65535).optional(),
  accessListId: z.string().cuid().nullable().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSession();
    const { id } = await params;
    const stream = await prisma.streamHost.findUnique({ where: { id } });
    if (!stream) return notFound("Stream not found");
    return ok(stream);
  } catch (e) { return fromError(e); }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const body = await req.json() as unknown;

    if (typeof body === "object" && body !== null && "enabled" in body) {
      const { stream, deploy } = await toggleStream(id, session.id);
      return ok({ stream, nginxTest: deploy });
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Invalid input");

    const loopError = checkSelfLoopPorts([parsed.data.listenPort]);
    if (loopError) return badRequest(loopError);

    const { stream, deploy } = await updateStream(id, parsed.data, session.id);
    return ok({ stream, nginxTest: deploy });
  } catch (e) { return fromError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const deploy = await deleteStream(id, session.id);
    return ok({ deleted: true, nginxTest: deploy });
  } catch (e) { return fromError(e); }
}
