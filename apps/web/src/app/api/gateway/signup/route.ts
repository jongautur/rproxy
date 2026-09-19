import { type NextRequest } from "next/server";
import { timingSafeEqual } from "crypto";
import { gatewaySignupSchema } from "@/lib/validation";
import { signupCustomer, DuplicateEmailError } from "@/server/services/api-gateway/signup.service";
import { ok, unauthorized, badRequest, conflict, fromError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

// Machine-to-machine endpoint sleik.is's backend calls at signup time to
// provision a free-tier Customer + ApiKey (see signup.service.ts). Not
// session-gated (there's no admin browser session in play) and not nginx's
// auth_request target either — reachable directly from sleik.is's backend
// over the LAN, so authenticated the same way as every other
// machine-to-machine endpoint in this app (CRON_SECRET, GATEWAY_AUTH_SECRET):
// a shared secret checked with timingSafeEqual. See middleware.ts's
// CSRF_EXEMPT_EXACT for why this path skips the cookie/CSRF checks that
// apply to browser-originated requests.
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
    const parsed = gatewaySignupSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid request body", parsed.error.flatten().fieldErrors);
    }

    const { uid, name, email } = parsed.data;
    const result = await signupCustomer(uid, name, email);
    return ok(result, 201);
  } catch (e) {
    if (e instanceof DuplicateEmailError) {
      return conflict("duplicate_email");
    }
    return fromError(e);
  }
}
