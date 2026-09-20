import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { checkAccess } from "@/server/services/api-gateway/gateway-auth.service";

export const dynamic = "force-dynamic";

// The internal endpoint nginx's `auth_request` directive calls for every
// key-protected API Gateway route (see api-gateway-config.ts). Reachable
// only via an `internal;` nginx location proxying from 127.0.0.1 — never
// exposed on a public listener — plus a shared-secret header as
// defense-in-depth in case that network boundary is ever misconfigured,
// following the exact CRON_SECRET/timingSafeEqual pattern used by every
// other machine-to-machine endpoint in this app (see
// app/api/cron/health-check/route.ts).
//
// nginx's auth_request module only understands three response classes from
// the subrequest: 2xx (allow), 401, and 403 — any other status is treated
// as an upstream error. A 429-worthy denial (rate limit/quota, from a later
// phase) is therefore still returned as a 403 here, with the real reason in
// the X-Gateway-Deny-Reason header; the nginx config remaps that header to
// a genuine client-visible 429 via a named error location. See
// api-gateway-config.ts for the auth_request_set/error_page wiring this
// response contract depends on.
function checkInternalSecret(req: NextRequest): boolean {
  const secret = process.env.GATEWAY_AUTH_SECRET;
  if (!secret) return false;

  const presented = req.headers.get("x-gateway-internal-secret") ?? "";
  const presentedBuf = Buffer.from(presented);
  const secretBuf = Buffer.from(secret);
  return presentedBuf.length === secretBuf.length && timingSafeEqual(presentedBuf, secretBuf);
}

export async function GET(req: NextRequest) {
  if (!checkInternalSecret(req)) {
    return new NextResponse(null, { status: 401 });
  }

  const apiKey = req.headers.get("x-api-key");
  const apiId = req.headers.get("x-gateway-api-id");
  const routeId = req.headers.get("x-gateway-route-id");
  // The real client method — a live nginx variable ($request_method), not
  // baked in at config-generation time — used to check a per-key method
  // sub-scope (see gateway-auth.service.ts#isRouteInScope). Falls back to
  // GET only in the "misconfigured caller" branch below, where it's moot.
  const method = req.headers.get("x-gateway-method") ?? "GET";

  if (!apiId || !routeId) {
    // Misconfigured caller (should never happen from our own generated
    // nginx config) — fail closed rather than passing an ambiguous request
    // through to checkAccess with an empty scope.
    return new NextResponse(null, { status: 403, headers: { "X-Gateway-Deny-Reason": "forbidden" } });
  }

  const result = await checkAccess(apiKey, apiId, routeId, method);

  // X-Gateway-RateLimit-* carry the per-second rate-limit layer's limit/
  // remaining back through nginx (see api-gateway-config.ts's
  // auth_request_set wiring), which re-exposes them to the actual caller as
  // the conventional X-RateLimit-Limit/X-RateLimit-Remaining — only present
  // when a rateLimit is configured at this layer.
  if (result.ok) {
    const headers: Record<string, string> = { "X-Gateway-Customer-Id": result.customerId };
    if (result.rateLimit !== undefined) headers["X-Gateway-RateLimit-Limit"] = String(result.rateLimit);
    if (result.rateRemaining !== undefined) headers["X-Gateway-RateLimit-Remaining"] = String(result.rateRemaining);
    return new NextResponse(null, { status: 200, headers });
  }

  const headers: Record<string, string> = {};
  if (result.denyReason) headers["X-Gateway-Deny-Reason"] = result.denyReason;
  if (result.rateLimit !== undefined) headers["X-Gateway-RateLimit-Limit"] = String(result.rateLimit);
  if (result.rateRemaining !== undefined) headers["X-Gateway-RateLimit-Remaining"] = String(result.rateRemaining);
  return new NextResponse(null, { status: result.status, headers: Object.keys(headers).length ? headers : undefined });
}
