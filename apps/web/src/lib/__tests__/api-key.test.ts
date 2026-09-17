import { describe, it, expect } from "vitest";
import { generateApiKeyPair, hashApiKey } from "../api-key";

describe("generateApiKeyPair", () => {
  it("produces a plaintext key starting with the prefix", () => {
    const { plaintext, keyPrefix } = generateApiKeyPair();
    expect(plaintext.startsWith(keyPrefix)).toBe(true);
  });

  it("stores only the hash — never the plaintext or anything it can be reversed from", () => {
    const { plaintext, keyHash } = generateApiKeyPair();
    expect(keyHash).not.toContain(plaintext);
    expect(hashApiKey(plaintext)).toBe(keyHash);
  });

  it("generates a hex-encoded SHA-256 digest (64 hex chars)", () => {
    const { keyHash } = generateApiKeyPair();
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("generates unique keys and prefixes across calls", () => {
    const a = generateApiKeyPair();
    const b = generateApiKeyPair();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.keyPrefix).not.toBe(b.keyPrefix);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});

describe("hashApiKey", () => {
  it("is deterministic — the same input always hashes the same way", () => {
    expect(hashApiKey("rpk_abcd1234_somesecret")).toBe(hashApiKey("rpk_abcd1234_somesecret"));
  });

  it("is sensitive to any change in the input", () => {
    expect(hashApiKey("rpk_abcd1234_somesecret")).not.toBe(hashApiKey("rpk_abcd1234_somesecreu"));
  });
});
