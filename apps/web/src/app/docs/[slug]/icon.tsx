import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
// Next only auto-injects a <link rel="icon"> for a code-generated icon route
// when it can determine the icon's type statically (without running the
// function) — without this export, the file still works as a route when
// hit directly, but Next silently skips wiring it into <head>, so the
// root app's own favicon.ico keeps winning.
export const contentType = "image/png";

// A file-convention icon (this file) beats anything set via
// generateMetadata/metadata objects — including the root app's own
// src/app/favicon.ico — for every route under this segment (see Next.js
// docs: "File-based metadata has the higher priority and will override the
// metadata object and generateMetadata function"). That's the only way to
// actually show a per-gateway custom logo instead of the rproxy favicon on
// /docs/[slug], since a plain metadata.icons override does not win against
// the root's file-convention favicon.ico.
export default async function Icon({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const api = await prisma.api.findUnique({ where: { docsSlug: slug }, select: { docsLogoUrl: true } });

  if (api?.docsLogoUrl) {
    try {
      const res = await fetch(api.docsLogoUrl);
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        return new Response(buffer, {
          headers: { "Content-Type": res.headers.get("content-type") || "image/png" },
        });
      }
    } catch {
      // Falls through to the app's own default icon below.
    }
  }

  const fallback = await readFile(path.join(process.cwd(), "src/app/favicon.ico"));
  return new Response(new Uint8Array(fallback), { headers: { "Content-Type": "image/x-icon" } });
}
