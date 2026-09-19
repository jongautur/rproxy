import { type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { gatewayRotateSchema } from "@/lib/validation";
import { rotateApiKey, CustomerNotFoundError } from "@/server/services/api-gateway/rotate.service";
import { ok, unauthorized, badRequest, notFound, fromError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Machine-to-machine endpoint sleik.is's backend calls to replace a
// customer's key (e.g. after a suspected leak) without any admin access to
// rproxy. Same shape as /api/gateway/signup: shared-secret authenticated
// (GATEWAY_SIGNUP_SECRET, timingSafeEqual), no session cookie, exempted
// from middleware.ts's CSRF/session checks the same way signup and
// auth-check are.
function checkSignupSecret(req: NextRequest): boolean {
  const secret = process.env.GATEWAY_SIGNUP_SECRET;
  if (!secret) return false;

  const presented = req.headers.get("x-gateway-signup-secret") ?? "";
  const presentedBuf = Buffer.from(presented);
  const secretBuf = Buffer.from(secret);
  return presentedBuf.length === secretBuf.length && timingSafeEqual(presentedBuf, secretBuf);
}

export async function POST(req: NextRequest) {
  try {
    if (!checkSignupSecret(req)) {
      return unauthorized();
    }

    const body = await req.json();
    const parsed = gatewayRotateSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid request body", parsed.error.flatten().fieldErrors);
    }

    const result = await rotateApiKey(parsed.data.customerId);
    return ok(result);
  } catch (e) {
    if (e instanceof CustomerNotFoundError) {
      return notFound("customer_not_found");
    }
    return fromError(e);
  }
}
