import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { generateOpenApiSpec } from "@/server/services/api-gateway/docs.service";
import { notFound } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export const dynamic = "force-dynamic";

// The document Scalar (and any external caller) actually fetches — same
// visibility rule as the sibling route.ts: public docs are open, private
// ones require a session. Never leaks upstream host/port/credentials; see
// docs.service.ts#generateOpenApiSpec.
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { slug } = await params;

  const api = await prisma.api.findUnique({ where: { docsSlug: slug } });
  if (!api || !api.docsEnabled) return notFound("Documentation not found");

  if (!api.docsPublic) {
    const session = await getSession();
    if (!session) return notFound("Documentation not found");
  }

  const { spec } = await generateOpenApiSpec(api.id);
  return NextResponse.json(spec);
}
