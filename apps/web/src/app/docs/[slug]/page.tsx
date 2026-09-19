import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { DocsViewer } from "./docs-viewer";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

// `title`/`icons` here replace (not deep-merge with) the root layout's —
// this is what overrides the rproxy app's own title/favicon for this route.
// A raw <title> tag inside the client-rendered DocsViewer doesn't reliably
// do this: it produces a second, invalid <title> element alongside the root
// layout's, and browsers are free to pick either (observed picking the root
// layout's). Icons point at icon.tsx's own route explicitly rather than
// relying on Next's automatic file-convention-to-<head> linking for a
// nested dynamic segment — that didn't reliably override the root layout's
// own explicit `metadata.icons` in testing, but an explicit icons value
// here unambiguously does (same "last segment wins" rule as title).
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const api = await prisma.api.findUnique({ where: { docsSlug: slug } });
  if (!api || !api.docsEnabled) return {};

  return {
    title: api.docsTitle || api.name,
    description: api.docsDescription || undefined,
    icons: { icon: `/docs/${slug}/icon` },
  };
}

// Deliberately outside the (app)/AppShell tree — this is a public developer
// portal page, not an admin screen, so it never gets the app's sidebar/auth
// chrome. Access rule mirrors the API routes it depends on: docsPublic APIs
// render for anyone, private ones require a session (an admin previewing
// their own not-yet-published docs).
export default async function DocsPage({ params }: PageProps) {
  const { slug } = await params;

  const api = await prisma.api.findUnique({ where: { docsSlug: slug } });
  if (!api || !api.docsEnabled) notFound();

  if (!api.docsPublic) {
    const session = await getSession();
    if (!session) notFound();
  }

  return <DocsViewer specUrl={`/api/gateway/public/${slug}/openapi.json`} />;
}
