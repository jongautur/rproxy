import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

// Derives a 32-byte AES key from JWT_SECRET with domain separation so we
// never reuse the raw secret value for two different purposes.
function getDerivedKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET");
  return createHash("sha256").update(`rproxy-creds-v1:${secret}`).digest();
}

// Format: v1:<base64(iv)>:<base64(authTag)>:<base64(ciphertext)>
export function encryptJson(data: Record<string, string>): string {
  const key = getDerivedKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptJson(value: string): Record<string, string> {
  if (!value.startsWith("v1:")) {
    // Legacy plaintext JSON — stored before encryption was added
    return JSON.parse(value) as Record<string, string>;
  }
  // v1:iv:authTag:ciphertext (colon-separated; colon never appears in standard base64)
  const parts = value.split(":");
  if (parts.length !== 4) throw new Error("Invalid encrypted credential format");
  const key = getDerivedKey();
  const iv = Buffer.from(parts[1]!, "base64");
  const authTag = Buffer.from(parts[2]!, "base64");
  const ciphertext = Buffer.from(parts[3]!, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8")) as Record<string, string>;
}
