import { createHash, randomBytes } from "crypto";

// API keys are high-entropy generated secrets, never human-chosen — unlike
// passwords, a fast deterministic hash is the correct tool here, not
// bcrypt: bcrypt is deliberately slow (defends against offline brute force
// of low-entropy human secrets) and isn't usable as a DB index anyway,
// which would make every request's auth_request lookup an O(n) table scan
// instead of an indexed exact match. SHA-256 over 224 bits of entropy has
// no meaningful brute-force surface, so a fast indexed lookup is safe.
//
// Split into a non-secret "prefix" (shown in the UI so admins can identify
// a key without ever re-displaying the secret) and a high-entropy secret
// suffix. Only the full key's hash is ever persisted; the plaintext exists
// only in the HTTP response at generation time.

const PREFIX_LABEL = "rpk";

export interface GeneratedApiKey {
  plaintext: string;
  keyPrefix: string;
  keyHash: string;
}

export function generateApiKeyPair(): GeneratedApiKey {
  const prefix = `${PREFIX_LABEL}_${randomBytes(4).toString("hex")}`;
  const secret = randomBytes(24).toString("base64url");
  const plaintext = `${prefix}_${secret}`;
  return { plaintext, keyPrefix: prefix, keyHash: hashApiKey(plaintext) };
}

export function hashApiKey(plaintextKey: string): string {
  return createHash("sha256").update(plaintextKey).digest("hex");
}
