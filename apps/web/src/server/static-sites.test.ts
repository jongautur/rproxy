import { describe, expect, it } from "vitest";
import { validateSiteFiles, staticSiteRoot, MAX_SITE_BYTES } from "./static-sites";

const index = { name: "index.html", size: 20 };
describe("static website uploads", () => {
  it("preserves nested asset paths", () => {
    expect(() => validateSiteFiles([index, { name: "assets/images/logo.png", size: 12 }])).not.toThrow();
  });
  it.each(["../secret", "/etc/passwd", "assets/../secret", "assets\\secret", ".env", "assets/.git/config", "a//b", "a\nroot x"]) ("rejects unsafe paths: %s", name => {
    expect(() => validateSiteFiles([index, { name, size: 1 }])).toThrow("Unsafe file path");
  });
  it("requires an entry page and enforces file and byte limits", () => {
    expect(() => validateSiteFiles([])).toThrow();
    expect(() => validateSiteFiles([{ name: "folder/index.html", size: 1 }])).toThrow("at its root");
    expect(() => validateSiteFiles([{ ...index, size: MAX_SITE_BYTES + 1 }])).toThrow("50 MB");
    expect(() => validateSiteFiles(Array.from({ length: 2001 }, () => index))).toThrow("2000");
  });
  it("rejects duplicate files and file/folder conflicts", () => {
    expect(() => validateSiteFiles([index, index])).toThrow("Duplicate");
    expect(() => validateSiteFiles([index, { name: "assets", size: 1 }, { name: "assets/style.css", size: 1 }])).toThrow("conflicts");
  });
  it("confines roots to validated host and revision identifiers", () => {
    expect(staticSiteRoot("host1", "00000000-0000-0000-0000-000000000000")).toContain("/static-sites/host1/");
    expect(() => staticSiteRoot("../secret", "00000000-0000-0000-0000-000000000000")).toThrow();
    expect(() => staticSiteRoot("host1", "../../secret")).toThrow();
  });
  it("multipart parsing keeps relative asset paths", async () => {
    const upload = new FormData();
    upload.append("files", new File(["body {}"], "assets/style.css"));
    const parsed = await new Response(upload).formData();
    expect((parsed.get("files") as File).name).toBe("assets/style.css");
  });
});
