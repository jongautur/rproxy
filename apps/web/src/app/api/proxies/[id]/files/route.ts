import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, badRequest, notFound, fromError } from "@/lib/api-response";
import { uploadStaticSite } from "@/server/services/proxy.service";
import { MAX_SITE_BYTES, StaticUploadError } from "@/server/static-sites";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireAdmin();
    const { id } = await params;
    const proxy = await prisma.proxyHost.findUnique({ where: { id } });
    if (!proxy) return notFound("Host not found");
    if (proxy.hostType !== "STATIC") return badRequest("Choose Static website before uploading files");
    if (!req.headers.get("content-type")?.startsWith("multipart/form-data;")) return badRequest("Expected a file upload");
    // Bound the entire multipart body before parsing, including chunked requests.
    const limit = MAX_SITE_BYTES + 2 * 1024 * 1024;
    if (Number(req.headers.get("content-length")) > limit) return badRequest("Upload exceeds 50 MB");
    const reader = req.body?.getReader();
    if (!reader) return badRequest("No files uploaded");
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); return badRequest("Upload exceeds 50 MB"); }
      chunks.push(value);
    }
    let form: FormData;
    try {
      form = await new Response(Buffer.concat(chunks), { headers: { "Content-Type": req.headers.get("content-type")! } }).formData();
    } catch { return badRequest("Invalid file upload"); }
    const entries = form.getAll("files");
    if (entries.some(entry => typeof entry === "string")) return badRequest("Expected files");
    return ok(await uploadStaticSite(id, entries as File[], session.id));
  } catch (e) {
    if (e instanceof StaticUploadError) return badRequest(e.message);
    return fromError(e);
  }
}
