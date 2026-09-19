import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notFound } from "@/lib/api-response";

interface RouteParams {
  params: Promise<{ slug: string }>;
}

// Minimal, deliberately-narrow public view used by /docs/[slug] to decide
// what to render — never includes upstream details, route lists, or
// anything beyond what a developer-portal landing page needs. Access rule:
// docsPublic APIs are servable to anyone; private ones require a logged-in
// session (this is still an internal admin viewing their own docs preview,
// not a real "share with this specific external user" mechanism).
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const { slug } = await params;

  const api = await prisma.api.findUnique({ where: { docsSlug: slug } });
  if (!api || !api.docsEnabled) return notFound("Documentation not found");

  if (!api.docsPublic) {
    const session = await getSession();
    if (!session) return notFound("Documentation not found");
  }

  return NextResponse.json({
    success: true,
    data: {
      title: api.docsTitle || api.name,
      description: api.docsDescription,
      version: api.docsVersion,
      logoUrl: api.docsLogoUrl,
      public: api.docsPublic,
    },
  });
}
