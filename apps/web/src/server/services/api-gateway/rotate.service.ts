import { prisma } from "@/lib/prisma";
import { generateApiKeyPair } from "@/lib/api-key";
import { Prisma } from "@prisma/client";
import { isBlockedPath } from "./signup.service";

export interface RotateResult {
  customerId: string;
  accessId: string;
  apiKey: string;
}

// Thrown for both "no such customer" and "customer has no access to the
// signup Api" — route.ts maps this to 404 either way. Not distinguished
// further since the caller (sleik.is) only ever passes a customerId it
// itself provisioned via /signup, so either case means its local record is
// stale relative to rproxy.
export class CustomerNotFoundError extends Error {
  constructor() {
    super("customer_not_found");
  }
}

// Called by the /api/gateway/rotate route (shared-secret authenticated,
// same as signup — see route.ts) when sleik.is wants to replace a
// customer's key, e.g. after a suspected leak. Revokes every currently
// enabled key the customer holds and issues exactly one new one, scoped the
// same way signupCustomer() would scope a fresh signup — recomputed against
// the *current* set of enabled routes rather than copied from the old key,
// so a route added since the original signup is picked up (and still
// blocked if it falls under GATEWAY_SIGNUP_BLOCKED_PATH_PREFIXES).
export async function rotateApiKey(customerId: string): Promise<RotateResult> {
  const apiId = process.env.GATEWAY_SIGNUP_API_ID;
  if (!apiId) {
    throw new Error("GATEWAY_SIGNUP_API_ID is not configured — cannot rotate access to an unspecified Api");
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new CustomerNotFoundError();

    // Proves this customer actually has a grant on the signup Api, the same
    // thing signupCustomer() creates — a customerId with no such grant
    // isn't one this endpoint issued a key for.
    const access = await tx.apiAccess.findUnique({
      where: { customerId_apiId: { customerId, apiId } },
    });
    if (!access) throw new CustomerNotFoundError();

    // Rotation means exactly one live key going forward. ApiKeyRouteScope
    // rows for the revoked key(s) are left in place (harmless — they only
    // apply to a key that's now disabled) rather than deleted, since
    // disabling already fails auth-check closed for that key.
    await tx.apiKey.updateMany({
      where: { customerId, enabled: true },
      data: { enabled: false, revokedAt: new Date() },
    });

    // Same retry-on-prefix-collision approach as signupCustomer().
    let plaintextKey: string | null = null;
    let apiKeyId: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const generated = generateApiKeyPair();
      try {
        const created = await tx.apiKey.create({
          data: {
            customerId: customer.id,
            label: "sleik.is signup",
            keyPrefix: generated.keyPrefix,
            keyHash: generated.keyHash,
            scopeRestricted: true,
          },
        });
        plaintextKey = generated.plaintext;
        apiKeyId = created.id;
        break;
      } catch (e) {
        const isConflict = e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
        if (!isConflict || attempt === 4) throw e;
      }
    }
    if (!plaintextKey || !apiKeyId) {
      throw new Error("Failed to generate a unique API key after several attempts");
    }

    const routes = await tx.apiRoute.findMany({ where: { apiId, enabled: true } });
    const allowedRoutes = routes.filter((r) => !isBlockedPath(r.path));
    if (allowedRoutes.length > 0) {
      await tx.apiKeyRouteScope.createMany({
        data: allowedRoutes.map((r) => ({ apiKeyId: apiKeyId!, routeId: r.id })),
      });
    }

    await tx.auditLog.create({
      data: {
        userId: null,
        action: "UPDATE",
        entity: "Customer",
        entityId: customer.id,
        details: JSON.stringify({ source: "sleik.is-rotate" }),
      },
    });

    return { customerId: customer.id, accessId: access.id, apiKey: plaintextKey };
  });
}
