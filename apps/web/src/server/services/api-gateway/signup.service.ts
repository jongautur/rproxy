import { prisma } from "@/lib/prisma";
import { generateApiKeyPair } from "@/lib/api-key";
import { Prisma } from "@prisma/client";

// Free tier granted to every sleik.is signup — deliberately low and not
// caller-configurable (sleik.is can't request a different tier through this
// endpoint); raising a specific customer's limits afterward is an admin-UI
// action against the resulting ApiAccess row, not something this flow does.
const FREE_TIER_RATE_LIMIT_PER_SECOND = 2;
const FREE_TIER_DAILY_QUOTA = 200;
const FREE_TIER_MONTHLY_QUOTA = 2000;

// Every key this endpoint issues is allowlist-scoped (ApiKey.scopeRestricted
// + ApiKeyRouteScope), never left unrestricted — ApiAccess above grants the
// customer access to the whole Api, but home-automation routes (/home/...)
// must never be reachable by a public self-signup key regardless of that
// grant. Allowlisting (rather than denylisting "/home") means a new route
// added later is blocked by default until an admin explicitly widens a
// specific customer's key scope through the admin UI — the safe failure
// mode per isRouteInScope() in gateway-auth.service.ts (scopeRestricted with
// zero matching rows blocks everything, it never falls back to open).
// Configurable, not hardcoded to "/home" alone, in case other sensitive
// route trees are added later.
const DEFAULT_BLOCKED_PATH_PREFIXES = "/home";

// Exported for reuse by rotate.service.ts, which must apply the exact same
// allowlist rule when recomputing a rotated key's scope.
export function isBlockedPath(path: string): boolean {
  const prefixes = (process.env.GATEWAY_SIGNUP_BLOCKED_PATH_PREFIXES ?? DEFAULT_BLOCKED_PATH_PREFIXES)
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export interface SignupResult {
  customerId: string;
  accessId: string;
  apiKey: string;
}

// Thrown when the email already belongs to a Customer — route.ts maps this
// to 409, distinct from an unexpected/internal failure.
export class DuplicateEmailError extends Error {
  constructor() {
    super("duplicate_email");
  }
}

// Called by the /api/gateway/signup route (shared-secret authenticated, see
// route.ts) on behalf of sleik.is. Pure DB writes — unlike Api/ApiRoute
// changes, ApiKey/ApiAccess have no nginx config footprint, so no deploy
// step here; gateway-auth.service.ts reads these rows live on every
// proxied request. `uid` is sleik.is's own Keycloak user id — rproxy has no
// column for it, it only goes into the audit log so a signup can be traced
// back to the originating sleik.is account.
export async function signupCustomer(uid: string, name: string, email: string): Promise<SignupResult> {
  const apiId = process.env.GATEWAY_SIGNUP_API_ID;
  if (!apiId) {
    throw new Error("GATEWAY_SIGNUP_API_ID is not configured — cannot grant access to an unspecified Api");
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({ data: { name, email } }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new DuplicateEmailError();
      }
      throw e;
    });

    // Same retry-on-prefix-collision approach as api-key.service.ts's
    // generateApiKey — kept separate rather than shared because that
    // function's audit-log write requires a real admin userId (a FK to
    // User), which doesn't exist for a machine-originated signup.
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
            // Allowlist-scoped from creation — see isBlockedPath() above.
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

    const access = await tx.apiAccess.create({
      data: {
        customerId: customer.id,
        apiId,
        rateLimitOverride: FREE_TIER_RATE_LIMIT_PER_SECOND,
        dailyQuota: FREE_TIER_DAILY_QUOTA,
        monthlyQuota: FREE_TIER_MONTHLY_QUOTA,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: null,
        action: "CREATE",
        entity: "Customer",
        entityId: customer.id,
        details: JSON.stringify({ source: "sleik.is-signup", uid }),
      },
    });

    return { customerId: customer.id, accessId: access.id, apiKey: plaintextKey };
  });
}
