import { type NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { updateStream, deleteStream, toggleStream } from "@/server/services/stream.service";
import { ok, badRequest, fromError } from "@/lib/api-response";
import { z } from "zod";

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  protocol: z.enum(["TCP", "UDP", "TCP_UDP"]).optional(),
  listenPort: z.number().int().min(1).max(65535).optional(),
  forwardHost: z.string().min(1).max(253).optional(),
  forwardPort: z.number().int().min(1).max(65535).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    const body = await req.json() as unknown;

    if (typeof body === "object" && body !== null && "enabled" in body) {
      const stream = await toggleStream(id, session.id);
      return ok({ stream });
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) return badRequest(parsed.error.errors[0]?.message ?? "Invalid input");
    const stream = await updateStream(id, parsed.data, session.id);
    return ok({ stream });
  } catch (e) { return fromError(e); }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    await deleteStream(id, session.id);
    return ok({ deleted: true });
  } catch (e) { return fromError(e); }
}
