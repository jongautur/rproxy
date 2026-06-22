import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import {
  generateSecret, buildOtpauthUri, generateQrSvg, enableTotp, disableTotp,
} from "@/server/services/totp.service";
import { ok, unauthorized, badRequest, fromError } from "@/lib/api-response";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET — generate a fresh secret + QR SVG (not yet saved)
export async function GET() {
  try {
    const session = await requireSession();

    const secret = generateSecret();
    const uri = buildOtpauthUri(secret, session.username);
    const qrSvg = await generateQrSvg(uri);

    return ok({ secret, qrSvg });
  } catch (e) {
    return fromError(e);
  }
}

// POST — enable TOTP: verify code against the provided secret, then save
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();

    const body = await req.json() as { secret?: string; code?: string };
    if (!body.secret || !body.code) return badRequest("secret and code required");

    const { backupCodes } = await enableTotp(session.id, body.secret, body.code);
    return ok({ backupCodes });
  } catch (e) {
    if (e instanceof Error && e.message === "Invalid TOTP code") {
      return badRequest("Invalid TOTP code — make sure your authenticator app is synced");
    }
    return fromError(e);
  }
}

// DELETE — disable TOTP: verify current TOTP or backup code first
export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();

    const body = await req.json() as { code?: string };
    if (!body.code) return badRequest("code required");

    await disableTotp(session.id, body.code);

    // Return updated totp status
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.id },
      select: { totpEnabled: true },
    });
    return ok({ totpEnabled: user.totpEnabled });
  } catch (e) {
    if (e instanceof Error && e.message === "Invalid code") {
      return badRequest("Invalid code");
    }
    return fromError(e);
  }
}
