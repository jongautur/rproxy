import { NextRequest } from "next/server";
import { requireSession, requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteCertificate } from "@/server/services/certificate.service";
import { ok, notFound, conflict, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { id } = await params;

    const cert = await prisma.certificate.findUnique({
      where: { id },
      include: { proxyHosts: { select: { id: true, domain: true } } },
    });

    if (!cert) return notFound("Certificate not found");
    return ok(cert);
  } catch (e) {
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
  try {
    const session = await requireAdmin();
    const { id } = await params;

    const cert = await prisma.certificate.findUnique({
      where: { id },
      include: { proxyHosts: { select: { id: true } } },
    });

    if (!cert) return notFound("Certificate not found");

    if (cert.proxyHosts.length > 0) {
      return conflict("Certificate is in use by one or more proxy hosts. Detach it first.");
    }

    await deleteCertificate(id, session.id);
    return ok({ message: "Certificate deleted" });
  } catch (e) {
    return fromError(e);
  }
}
