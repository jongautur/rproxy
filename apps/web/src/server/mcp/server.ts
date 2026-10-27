import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  proxyHostSchema, redirectHostSchema, certificateSchema, apiRouteSchema,
  streamHostSchema, streamHostPatchSchema, checkSelfLoopPorts,
} from "@/lib/validation";
import { createProxy, updateProxy, toggleProxy } from "@/server/services/proxy.service";
import { createRedirect, updateRedirect, toggleRedirect } from "@/server/services/redirect.service";
import { createStream, updateStream, toggleStream } from "@/server/services/stream.service";
import { createCertificate } from "@/server/services/certificate.service";
import { listAccessLists } from "@/server/services/access-list.service";
import { getLatestHealthChecks } from "@/server/services/health.service";
import { createRoute, updateRoute, listRoutes } from "@/server/services/api-gateway/route.service";
import type { McpPrincipal } from "@/server/services/mcp-token.service";

// The MCP surface is a thin adapter over the same services the REST routes
// use, never a second implementation: every write goes through the shared
// zod schemas (enforced by the SDK before the handler runs) and then the
// service layer, so it inherits nginx-deploy.service's stage → nginx -t →
// reload-or-rollback transaction and the existing audit logging. Pre-service
// checks that live in the route handlers (duplicate domain, self-loop ports,
// existence) are mirrored here — keep the two in step.
//
// Deliberately not exposed: deletes, users, settings/secrets (Cloudflare,
// notifications, TOTP), API Gateway customers/keys, raw nginx reload. Add
// them deliberately, not by default.

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

// Certificate rows carry dnsCredentials (encrypted, but still not something
// to hand an agent) — always select explicitly.
const certificateSummary = {
  id: true, domain: true, provider: true, challengeType: true, status: true,
  issuer: true, sans: true, expiresAt: true, issuedAt: true, autoRenew: true,
  lastRenewAt: true, renewError: true, dnsProvider: true,
} as const;

function json(data: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

// A deploy that failed nginx -t was already rolled back by the service, but
// the DB row may have changed — report it as a tool error so the agent
// doesn't treat it as success, while still returning the nginx output.
function deployed(data: Record<string, unknown>, deploy: { success: boolean; output: string }): CallToolResult {
  const result = json({ ...data, nginx: deploy });
  return deploy.success ? result : { ...result, isError: true };
}

async function guarded(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (e) {
    console.error("[mcp]", e);
    return fail(e instanceof Error ? e.message : "Internal error");
  }
}

export function buildMcpServer(principal: McpPrincipal, clientIp: string): McpServer {
  const server = new McpServer(
    { name: "rproxy", version: "1.0.0" },
    {
      instructions:
        "rproxy manages nginx on this host: proxy hosts, redirects, TCP/UDP streams, Let's Encrypt certificates " +
        "and an API Gateway. Every write is validated, tested with `nginx -t` and rolled back on failure. " +
        "Look things up with the list_* tools before changing them, and pass ids exactly as returned.",
    }
  );

  const userId = principal.userId;
  const log = (tool: string) => console.log(`[mcp] ${principal.username} (${principal.scope}) ${tool} from ${clientIp}`);

  // ── Read tools ──────────────────────────────────────────────────────────────

  server.registerTool("whoami", {
    description: "Show the rproxy user and scope this MCP token acts as.",
    annotations: READ_ONLY,
  }, async () => json({ username: principal.username, role: principal.role, scope: principal.scope }));

  server.registerTool("list_proxy_hosts", {
    description: "List proxy hosts (domain → upstream). Optional case-insensitive search on domain or upstream host.",
    inputSchema: {
      search: z.string().max(253).optional(),
      status: z.enum(["ACTIVE", "DISABLED", "ERROR"]).optional(),
    },
    annotations: READ_ONLY,
  }, async ({ search, status }) => guarded(async () => {
    const items = await prisma.proxyHost.findMany({
      where: {
        ...(search && {
          OR: [
            { domain: { contains: search, mode: "insensitive" as const } },
            { forwardHost: { contains: search, mode: "insensitive" as const } },
          ],
        }),
        ...(status && { status }),
      },
      select: {
        id: true, domain: true, forwardScheme: true, forwardHost: true, forwardPort: true,
        sslEnabled: true, forceHttps: true, enabled: true, status: true, certificateId: true, accessListId: true,
      },
      orderBy: { domain: "asc" },
    });
    return json({ count: items.length, items });
  }));

  server.registerTool("get_proxy_host", {
    description: "Get one proxy host's full configuration, including custom nginx directives and its certificate.",
    inputSchema: { id: z.string() },
    annotations: READ_ONLY,
  }, async ({ id }) => guarded(async () => {
    const proxy = await prisma.proxyHost.findUnique({
      where: { id },
      include: { certificate: { select: certificateSummary } },
    });
    return proxy ? json(proxy) : fail("Proxy host not found");
  }));

  server.registerTool("list_redirect_hosts", {
    description: "List redirect hosts (source domain → destination URL).",
    inputSchema: { search: z.string().max(253).optional() },
    annotations: READ_ONLY,
  }, async ({ search }) => guarded(async () => {
    const items = await prisma.redirectHost.findMany({
      where: search ? { sourceDomain: { contains: search, mode: "insensitive" as const } } : {},
      orderBy: { sourceDomain: "asc" },
    });
    return json({ count: items.length, items });
  }));

  server.registerTool("list_stream_hosts", {
    description: "List TCP/UDP stream hosts (listen port → upstream host:port).",
    annotations: READ_ONLY,
  }, async () => guarded(async () => {
    const items = await prisma.streamHost.findMany({ orderBy: { listenPort: "asc" } });
    return json({ count: items.length, items });
  }));

  server.registerTool("list_certificates", {
    description: "List TLS certificates with status, expiry and which proxy hosts use them.",
    inputSchema: { search: z.string().max(253).optional() },
    annotations: READ_ONLY,
  }, async ({ search }) => guarded(async () => {
    const items = await prisma.certificate.findMany({
      where: search ? { domain: { contains: search, mode: "insensitive" as const } } : {},
      select: { ...certificateSummary, proxyHosts: { select: { id: true, domain: true } } },
      orderBy: { domain: "asc" },
    });
    return json({ count: items.length, items });
  }));

  server.registerTool("list_access_lists", {
    description: "List access lists (IP allow/deny rules and basic-auth users) and the hosts using them. Password hashes are not returned.",
    annotations: READ_ONLY,
  }, async () => guarded(async () => json(await listAccessLists())));

  server.registerTool("get_health_status", {
    description: "Latest upstream health check result for every proxy host.",
    annotations: READ_ONLY,
  }, async () => guarded(async () => {
    const [checks, proxies] = await Promise.all([
      getLatestHealthChecks(),
      prisma.proxyHost.findMany({ select: { id: true, domain: true } }),
    ]);
    return json(proxies.map((p) => ({ proxyId: p.id, domain: p.domain, ...(checks[p.id] ?? { status: "UNKNOWN" }) })));
  }));

  server.registerTool("list_gateway_apis", {
    description: "List API Gateway APIs (domain + base path) with route and customer-grant counts.",
    annotations: READ_ONLY,
  }, async () => guarded(async () => {
    const items = await prisma.api.findMany({
      include: { certificate: { select: certificateSummary }, _count: { select: { routes: true, access: true } } },
      orderBy: { createdAt: "desc" },
    });
    return json({ count: items.length, items });
  }));

  server.registerTool("list_gateway_routes", {
    description: "List the routes of one API Gateway API. Upstream auth secrets are never returned.",
    inputSchema: { apiId: z.string() },
    annotations: READ_ONLY,
  }, async ({ apiId }) => guarded(async () => {
    const api = await prisma.api.findUnique({ where: { id: apiId }, select: { id: true } });
    if (!api) return fail("API not found");
    return json(await listRoutes(apiId));
  }));

  server.registerTool("list_gateway_customers", {
    description: "List API Gateway customers (search by id, name or email) with key and grant counts. Keys themselves are never returned.",
    inputSchema: { search: z.string().max(253).optional() },
    annotations: READ_ONLY,
  }, async ({ search }) => guarded(async () => {
    const items = await prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { id: search },
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {},
      include: { _count: { select: { apiKeys: true, access: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return json({ count: items.length, items });
  }));

  if (principal.scope !== "WRITE") return server;

  // ── Write tools (WRITE-scoped tokens of ADMIN users only) ──────────────────

  server.registerTool("create_proxy_host", {
    description: "Create a proxy host and deploy it (nginx -t, reload, or roll back). For HTTPS, issue a certificate first with request_certificate and pass its id with sslEnabled: true.",
    inputSchema: proxyHostSchema,
    annotations: WRITE,
  }, async (data) => guarded(async () => {
    log("create_proxy_host");
    const loopError = checkSelfLoopPorts([data.listenPort, data.httpsPort]);
    if (loopError) return fail(loopError);
    if (await prisma.proxyHost.findUnique({ where: { domain: data.domain } })) {
      return fail("A proxy for this domain already exists");
    }
    const { proxy, deploy, dnsRecord } = await createProxy(data, userId);
    return deployed({ proxy, dnsRecord }, deploy);
  }));

  server.registerTool("update_proxy_host", {
    description: "Update fields of an existing proxy host and redeploy it. Only the fields you pass are changed.",
    inputSchema: z.object({ id: z.string() }).merge(proxyHostSchema.partial()),
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ id, ...data }) => guarded(async () => {
    log("update_proxy_host");
    if (!(await prisma.proxyHost.findUnique({ where: { id }, select: { id: true } }))) return fail("Proxy host not found");
    const loopError = checkSelfLoopPorts([data.listenPort, data.httpsPort]);
    if (loopError) return fail(loopError);
    const { proxy, deploy } = await updateProxy(id, data, userId);
    return deployed({ proxy }, deploy);
  }));

  server.registerTool("set_proxy_host_enabled", {
    description: "Enable or disable a proxy host (disabling removes it from nginx but keeps its configuration).",
    inputSchema: { id: z.string(), enabled: z.boolean() },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ id, enabled }) => guarded(async () => {
    log("set_proxy_host_enabled");
    if (!(await prisma.proxyHost.findUnique({ where: { id }, select: { id: true } }))) return fail("Proxy host not found");
    const { proxy, deploy } = await toggleProxy(id, enabled, userId);
    return deployed({ proxy }, deploy);
  }));

  server.registerTool("create_redirect_host", {
    description: "Create a redirect host (sourceDomain → destination URL, 301 or 302) and deploy it.",
    inputSchema: redirectHostSchema,
    annotations: WRITE,
  }, async (data) => guarded(async () => {
    log("create_redirect_host");
    if (await prisma.redirectHost.findUnique({ where: { sourceDomain: data.sourceDomain } })) {
      return fail("A redirect for this domain already exists");
    }
    const { redirect, deploy } = await createRedirect(data, userId);
    return deployed({ redirect }, deploy);
  }));

  server.registerTool("update_redirect_host", {
    description: "Update fields of an existing redirect host and redeploy it.",
    inputSchema: z.object({ id: z.string() }).merge(redirectHostSchema.partial()),
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ id, ...data }) => guarded(async () => {
    log("update_redirect_host");
    if (!(await prisma.redirectHost.findUnique({ where: { id }, select: { id: true } }))) return fail("Redirect host not found");
    const { redirect, deploy } = await updateRedirect(id, data, userId);
    return deployed({ redirect }, deploy);
  }));

  server.registerTool("set_redirect_host_enabled", {
    description: "Enable or disable a redirect host.",
    inputSchema: { id: z.string(), enabled: z.boolean() },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ id, enabled }) => guarded(async () => {
    log("set_redirect_host_enabled");
    if (!(await prisma.redirectHost.findUnique({ where: { id }, select: { id: true } }))) return fail("Redirect host not found");
    const { redirect, deploy } = await toggleRedirect(id, enabled, userId);
    return deployed({ redirect }, deploy);
  }));

  server.registerTool("create_stream_host", {
    description: "Create a TCP/UDP stream (nginx stream module: listenPort → forwardHost:forwardPort) and deploy it.",
    inputSchema: streamHostSchema,
    annotations: WRITE,
  }, async (data) => guarded(async () => {
    log("create_stream_host");
    const loopError = checkSelfLoopPorts([data.listenPort]);
    if (loopError) return fail(loopError);
    if (await prisma.streamHost.findUnique({ where: { name: data.name } })) {
      return fail("A stream host with that name already exists");
    }
    const { stream, deploy } = await createStream(data, userId);
    return deployed({ stream }, deploy);
  }));

  server.registerTool("update_stream_host", {
    description: "Update fields of an existing stream host and redeploy it. Use set_stream_host_enabled to enable/disable.",
    inputSchema: z.object({ id: z.string() }).merge(streamHostPatchSchema.omit({ enabled: true })),
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ id, ...data }) => guarded(async () => {
    log("update_stream_host");
    if (!(await prisma.streamHost.findUnique({ where: { id }, select: { id: true } }))) return fail("Stream host not found");
    const loopError = checkSelfLoopPorts([data.listenPort]);
    if (loopError) return fail(loopError);
    const { stream, deploy } = await updateStream(id, data, userId);
    return deployed({ stream }, deploy);
  }));

  server.registerTool("set_stream_host_enabled", {
    description: "Enable or disable a stream host.",
    inputSchema: { id: z.string(), enabled: z.boolean() },
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ id, enabled }) => guarded(async () => {
    log("set_stream_host_enabled");
    const existing = await prisma.streamHost.findUnique({ where: { id }, select: { enabled: true } });
    if (!existing) return fail("Stream host not found");
    // toggleStream flips the current state, so only call it when it differs.
    if (existing.enabled === enabled) return json({ unchanged: true, enabled });
    const { stream, deploy } = await toggleStream(id, userId);
    return deployed({ stream }, deploy);
  }));

  server.registerTool("request_certificate", {
    description: "Issue a Let's Encrypt (HTTP-01 or DNS-01) or self-signed certificate for a domain. HTTP-01 needs the domain's public DNS and port 80 to reach this host. Returns the certificate id to use on a proxy host.",
    inputSchema: certificateSchema.extend({ provider: z.enum(["LETSENCRYPT", "SELF_SIGNED"]) }),
    annotations: { ...WRITE, openWorldHint: true },
  }, async (data) => guarded(async () => {
    log("request_certificate");
    const { certificate, output, dnsRecord } = await createCertificate(data, userId);
    // createCertificate throws on a failed issuance (caught by guarded()), so
    // reaching here means the cert is ACTIVE.
    const summary = await prisma.certificate.findUnique({ where: { id: certificate.id }, select: certificateSummary });
    return json({ certificate: summary, dnsRecord, output });
  }));

  server.registerTool("create_gateway_route", {
    description: "Add a route (path + methods → upstream) to an API Gateway API and deploy it together with the shared rate-limit zones.",
    inputSchema: z.object({ apiId: z.string() }).merge(apiRouteSchema),
    annotations: WRITE,
  }, async ({ apiId, ...data }) => guarded(async () => {
    log("create_gateway_route");
    if (!(await prisma.api.findUnique({ where: { id: apiId }, select: { id: true } }))) return fail("API not found");
    if (await prisma.apiRoute.findUnique({ where: { apiId_path: { apiId, path: data.path } } })) {
      return fail("A route with this path already exists on this API");
    }
    const { route, deploy } = await createRoute(apiId, data, userId);
    return deployed({ route }, deploy);
  }));

  server.registerTool("update_gateway_route", {
    description: "Update fields of an existing API Gateway route and redeploy. An omitted upstreamAuthValue keeps the stored secret.",
    inputSchema: z.object({ apiId: z.string(), routeId: z.string() }).merge(apiRouteSchema.partial()),
    annotations: { ...WRITE, idempotentHint: true },
  }, async ({ apiId, routeId, ...data }) => guarded(async () => {
    log("update_gateway_route");
    const existing = await prisma.apiRoute.findUnique({ where: { id: routeId }, select: { apiId: true } });
    if (!existing || existing.apiId !== apiId) return fail("Route not found");
    const { route, deploy } = await updateRoute(apiId, routeId, data, userId);
    return deployed({ route }, deploy);
  }));

  return server;
}
