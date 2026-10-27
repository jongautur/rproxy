# MCP Server (AI agents)

rproxy has a built-in [Model Context Protocol](https://modelcontextprotocol.io) server, so AI agents (Claude Code, Claude Desktop, or any MCP client) on other machines can inspect and change rproxy configuration. It runs inside the existing app on the same port. There's no extra process, no extra service, and no cost beyond the agent's own model usage.

## Endpoint and transport

- **URL:** `https://<your rproxy UI domain>/api/mcp` (or `http://<host>:81/api/mcp` on the LAN)
- **Transport:** Streamable HTTP, stateless (no `Mcp-Session-Id`). Each request is self-contained, so a PM2 restart never strands an agent.
- **Auth:** `Authorization: Bearer rpm_…` (an MCP token, see below). Session cookies are not accepted here, and the endpoint is exempt from the cookie/CSRF checks in `middleware.ts`, the same as `/api/gateway/auth-check`.
- **Rate limit:** 120 requests/minute per client IP and per token (in-process, like the login limiter).

The endpoint is reachable from wherever the rproxy UI is. If the UI's proxy host has an IP allowlist, agents must connect from inside it (LAN/VPN). Don't widen the allowlist just for MCP. Put the agent's machine on the VPN instead.

## Tokens

**Settings → MCP → New token.** You choose:

| Field | Options |
|---|---|
| Name | Free text, e.g. `laptop agent` |
| Access | **Read only**, or **Read + write** (admins only) |
| Expires | 30 days / 90 days / 1 year / never |

The token (`rpm_<prefix>_<secret>`) is shown **once**. Only its SHA-256 hash is stored, the same scheme as API Gateway keys (`lib/api-key.ts`). Tokens can be revoked from the same page. Revocation is immediate and the row is kept for the record.

A token always acts **as the user who created it**, and it's re-validated on every request:

- Revoked or expired → 401.
- The user's `tokenVersion` was bumped (password change, role change, forced logout) → **all their MCP tokens stop working** → 401. Create new ones.
- The user was demoted to Viewer → a write token is silently downgraded to read-only.
- The user has `mustChangePassword` set → 401.

Creating and revoking tokens is recorded in the audit log (`McpToken`). Changes made through write tools are audited by the normal services under the token's user, so they show up in the activity log exactly like UI changes. Every MCP tool call is also logged to the app log as `[mcp] <user> (<scope>) <tool> from <ip>`.

## Connecting an agent

Claude Code:

```bash
claude mcp add --transport http rproxy https://rproxy.example.com/api/mcp \
  --header "Authorization: Bearer rpm_xxxxxxxx_..."
```

Any other client: configure a Streamable HTTP server with that URL and header. The Settings → MCP page shows the exact URL for your instance.

## Tools

Read tools (any token):

| Tool | What it returns |
|---|---|
| `whoami` | The user and effective scope the token acts as |
| `list_proxy_hosts` | Proxy hosts (search by domain/upstream, filter by status) |
| `get_proxy_host` | One proxy host's full config, incl. custom directives and certificate summary |
| `list_redirect_hosts` | Redirect hosts |
| `list_stream_hosts` | TCP/UDP streams |
| `list_certificates` | Certificates with status/expiry and the hosts using them |
| `list_access_lists` | Access lists, IP rules, basic-auth usernames (never password hashes) |
| `get_health_status` | Latest health check per proxy host |
| `list_gateway_apis` | API Gateway APIs with route/grant counts |
| `list_gateway_routes` | Routes of one API (never the upstream auth secret) |
| `list_gateway_customers` | Gateway customers with key/grant counts (never keys) |

Write tools (write tokens only. A read token doesn't even see them in `tools/list`):

| Tool | Notes |
|---|---|
| `create_proxy_host`, `update_proxy_host`, `set_proxy_host_enabled` | Same schema as the UI (`proxyHostSchema`), incl. the custom-directive blocklist |
| `create_redirect_host`, `update_redirect_host`, `set_redirect_host_enabled` | |
| `create_stream_host`, `update_stream_host`, `set_stream_host_enabled` | |
| `request_certificate` | Let's Encrypt (HTTP-01/DNS-01) or self-signed. Custom uploads stay in the UI |
| `create_gateway_route`, `update_gateway_route` | Deployed with the shared rate-limit zones file (`deployConfigBatch`) |

Every write uses the same zod schemas and service functions as the REST API, so it goes through the same stage → `nginx -t` → reload-or-rollback transaction. A change that fails `nginx -t` comes back as a tool error with the nginx output, and nginx keeps running the previous config.

**Deliberately not exposed:** deleting anything, users, settings and secrets (Cloudflare, notifications, TOTP), API Gateway customers/keys/grants, and raw nginx reload. These stay in the UI. Adding any of them is a deliberate decision, not a default.

## Risks to keep in mind

- `nginx -t` catches broken config, not *wrong* config. An agent with a write token can point a live domain at the wrong upstream, or disable a host, and nginx will happily serve it. Give agents read tokens unless they really need to change things, and use short expiries for write tokens.
- A write token is effectively an admin credential for everything above. Store it like one (the agent's MCP config file, not a repo).

## Implementation map

- `prisma/schema.prisma` → `McpToken`, `McpTokenScope`
- `src/server/services/mcp-token.service.ts`: generate/list/create/revoke/authenticate
- `src/server/mcp/server.ts`: tool definitions (thin adapters over the services)
- `src/app/api/mcp/route.ts`: the HTTP endpoint (auth, rate limit, per-request server/transport)
- `src/app/api/settings/mcp-tokens/*`: token management API for the Settings tab
- `src/app/settings/components/mcp-tab.tsx`: Settings → MCP
