import path from "path";
import { mkdir, writeFile, rm } from "fs/promises";
import { randomUUID } from "crypto";

export const STATIC_SITES_DIR = "/var/lib/rproxy/static-sites";
export const MAX_SITE_BYTES = 50 * 1024 * 1024;
export const MAX_SITE_FILES = 2000;
export class StaticUploadError extends Error {}

export function staticHostDirectory(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("Invalid static host identifier");
  return path.join(STATIC_SITES_DIR, id);
}

export function staticSiteRoot(id: string, revision: string): string {
  if (!/^[a-f0-9-]{36}$/.test(revision)) {
    throw new Error("Invalid static site identifier");
  }
  return path.join(staticHostDirectory(id), revision);
}

export function validateSiteFiles(files: { name: string; size: number }[]): void {
  if (!files.length || files.length > MAX_SITE_FILES) throw new StaticUploadError("Upload 1–2000 files");
  const seen = new Set<string>();
  let total = 0;
  for (const file of files) {
    const parts = file.name.split("/");
    if (file.name.length > 512 || parts.some(p => !p || p.startsWith(".") || !/^[a-zA-Z0-9_ ()@+.,-]+$/.test(p))) {
      throw new StaticUploadError(`Unsafe file path: ${file.name}`);
    }
    if (seen.has(file.name)) throw new StaticUploadError(`Duplicate file: ${file.name}`);
    seen.add(file.name);
    total += file.size;
    if (total > MAX_SITE_BYTES) throw new StaticUploadError("Website exceeds the 50 MB upload limit");
  }
  for (const name of seen) {
    const parts = name.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (seen.has(parts.slice(0, i).join("/"))) throw new StaticUploadError("A file conflicts with a folder path");
    }
  }
  if (!seen.has("index.html")) throw new StaticUploadError("The website must contain index.html at its root");
}

export async function stageSite(id: string, files: File[]): Promise<string> {
  validateSiteFiles(files);
  const revision = randomUUID();
  const root = staticSiteRoot(id, revision);
  await mkdir(root, { recursive: true, mode: 0o755 });
  try {
    for (const file of files) {
      const target = path.join(root, file.name);
      await mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await writeFile(target, Buffer.from(await file.arrayBuffer()), { mode: 0o644, flag: "wx" });
    }
    return revision;
  } catch (e) {
    await rm(root, { recursive: true, force: true });
    throw e;
  }
}
