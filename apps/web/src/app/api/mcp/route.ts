import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateMcpToken } from "@/server/services/mcp-token.service";
import { buildMcpServer } from "@/server/mcp/server";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Remote MCP endpoint (Streamable HTTP). Authenticated by an MCP bearer
// token, not the session cookie — exempted from middleware.ts's cookie and
// CSRF checks the same way /api/gateway/auth-check is, and authenticated
// here instead.
//
// Stateless: a fresh server + transport per request, no Mcp-Session-Id.
// Every tool call is self-contained, and statelessness means a PM2 restart
// never strands an agent's session.

const RATE_LIMIT_PER_MINUTE = 120;

function jsonRpcError(status: number, message: string, headers: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }),
    { status, headers: { "Content-Type": "application/json", ...headers } }
  );
}

async function handle(req: Request): Promise<Response> {
  const ip = getClientIp(req);

  const ipLimit = checkRateLimit(`mcp:ip:${ip}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!ipLimit.allowed) {
    return jsonRpcError(429, "Too many requests", { "Retry-After": String(ipLimit.retryAfterSeconds) });
  }

  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const principal = bearer ? await authenticateMcpToken(bearer) : null;
  if (!principal) {
    return jsonRpcError(401, "Unauthorized", { "WWW-Authenticate": 'Bearer realm="rproxy-mcp"' });
  }

  const tokenLimit = checkRateLimit(`mcp:token:${principal.tokenId}`, RATE_LIMIT_PER_MINUTE, 60_000);
  if (!tokenLimit.allowed) {
    return jsonRpcError(429, "Too many requests", { "Retry-After": String(tokenLimit.retryAfterSeconds) });
  }

  const server = buildMcpServer(principal, ip);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    await server.close();
  }
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
