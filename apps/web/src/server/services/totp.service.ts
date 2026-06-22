import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { prisma } from "@/lib/prisma";
import { encryptJson, decryptJson } from "@/lib/encrypt";

const ISSUER = "rproxy";
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, out = "";
  for (const b of buf) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(val << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Buffer {
  const s = str.toUpperCase().replace(/=+$/, "");
  const bytes: number[] = [];
  let bits = 0, val = 0;
  for (const ch of s) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) continue;
    val = (val << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", key).update(buf).digest();
  const offset = mac[19]! & 0xf;
  const code =
    (((mac[offset]! & 0x7f) << 24) |
      (mac[offset + 1]! << 16) |
      (mac[offset + 2]! << 8) |
      mac[offset + 3]!) %
    1_000_000;
  return String(code).padStart(6, "0");
}

export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

export function buildOtpauthUri(secret: string, username: string): string {
  const params = new URLSearchParams({
    secret,
    issuer: ISSUER,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(ISSUER)}:${encodeURIComponent(username)}?${params.toString()}`;
}

export async function generateQrSvg(otpauthUri: string): Promise<string> {
  return QRCode.toString(otpauthUri, {
    type: "svg",
    margin: 1,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

export function verifyToken(token: string, secret: string): boolean {
  try {
    const t = Math.floor(Date.now() / 30_000);
    return [-1, 0, 1].some((offset) => {
      const expected = hotp(secret, t + offset);
      const a = Buffer.from(token.padStart(6, "0"));
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
  } catch {
    return false;
  }
}

function generateBackupCodes(): string[] {
  return Array.from({ length: 8 }, () =>
    randomBytes(4).toString("hex").toUpperCase()
  );
}

export async function enableTotp(
  userId: string,
  secret: string,
  code: string
): Promise<{ backupCodes: string[] }> {
  if (!verifyToken(code, secret)) throw new Error("Invalid TOTP code");

  const backupCodes = generateBackupCodes();
  const hashedCodes = await Promise.all(
    backupCodes.map((c) => bcrypt.hash(c, 10))
  );

  await prisma.user.update({
    where: { id: userId },
    data: {
      totpEnabled: true,
      totpSecret: encryptJson({ v: secret }),
      totpBackupCodes: hashedCodes,
    },
  });

  return { backupCodes };
}

export async function disableTotp(userId: string, code: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { totpSecret: true, totpBackupCodes: true },
  });

  const valid = await verifyCodeOrBackup(code, user.totpSecret, user.totpBackupCodes);
  if (!valid) throw new Error("Invalid code");

  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: false, totpSecret: null, totpBackupCodes: [] },
  });
}

export async function verifyMfaCode(userId: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true, totpSecret: true, totpBackupCodes: true },
  });
  if (!user?.totpEnabled || !user.totpSecret) return false;
  return verifyCodeOrBackup(code, user.totpSecret, user.totpBackupCodes);
}

async function verifyCodeOrBackup(
  code: string,
  encryptedSecret: string | null,
  backupHashes: string[]
): Promise<boolean> {
  if (!encryptedSecret) return false;
  const secret = decryptJson(encryptedSecret).v!;

  // 6-digit TOTP
  if (/^\d{6}$/.test(code)) return verifyToken(code, secret);

  // 8-char backup code (case-insensitive)
  const upper = code.toUpperCase();
  for (const hash of backupHashes) {
    if (await bcrypt.compare(upper, hash)) return true;
  }
  return false;
}
