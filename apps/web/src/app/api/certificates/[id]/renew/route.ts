import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { renewCert } from "@/server/services/certificate.service";
import { ok, notFound, badRequest, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const cert = await prisma.certificate.findUnique({ where: { id } });
    if (!cert) return notFound("Certificate not found");

    if (cert.provider !== "LETSENCRYPT") {
      return badRequest("Only Let's Encrypt certificates can be renewed via this endpoint");
    }

    const { certificate, output } = await renewCert(id, session.id);
    return ok({ certificate, output });
  } catch (e) {
    return fromError(e);
  }
}
