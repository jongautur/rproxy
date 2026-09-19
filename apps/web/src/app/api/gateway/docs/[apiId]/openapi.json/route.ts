import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateOpenApiSpec } from "@/server/services/api-gateway/docs.service";
import { notFound, fromError } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ apiId: string }>;
}

// Admin-side preview — always session-gated regardless of the Api's
// docsPublic flag, unlike /api/gateway/public/[slug]/openapi.json which is
// the one actually served to external callers/Scalar.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  try {
    await requireSession();
    const { apiId } = await params;

    const api = await prisma.api.findUnique({ where: { id: apiId } });
    if (!api) return notFound("API not found");

    const { spec } = await generateOpenApiSpec(apiId);
    return NextResponse.json(spec);
  } catch (e) {
    return fromError(e);
  }
}
