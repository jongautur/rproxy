# API Gateway

A second, separate proxying surface from Proxy Hosts (**API Gateway** in the left nav), for exposing specific backend routes to external customers under hashed API keys — rate-limited, quota-metered, and scoped per customer — rather than a plain open reverse proxy. Deliberately not built on top of Proxy Hosts; it has its own domain model, its own nginx config generator, and its own admin pages.

## Concept and data model

```
Api            a domain (+ optional base path) — "the site"
 └─ ApiRoute   a path + HTTP method set + its own upstream target
                 (one route = one location block = one upstream — no per-method upstream splitting)

Customer       an external party you're granting access to
 ├─ ApiKey     a credential belonging to a customer (a customer can have several)
 │   └─ ApiKeyRouteScope   optional per-key restriction to specific routes/methods
 └─ ApiAccess  the actual grant: "this customer may call this Api",
               plus a default rate limit / daily quota / monthly quota
     └─ ApiRouteAccess     optional per-customer override of one route's limits
```

A customer with no `ApiAccess` row for an `Api` can't call it at all, regardless of having a valid key. A key with no `ApiKeyRouteScope` rows inherits everything the customer's `ApiAccess` allows; a key with `scopeRestricted` on and specific rows can *only* reach those routes (see [Self-signup](#self-signup-endpoint) below for why that matters).

## Setting up a new gateway API — step by step

1. **API Gateway → Add API.** Fields: Name, Domain (e.g. `api.example.com`), Base Path (optional prefix applied to every route), Description, Listen Port (default 80) / HTTPS Port (default 443), SSL enabled + Certificate, **Max requests/sec** (a server-wide safety ceiling routes fall back to if they don't set their own), Max body size (MB), CORS enabled (permissive — allows *any* origin; there's no per-origin allowlist).
2. **Add one or more Routes** on that API: Path (e.g. `/geocode`), Methods (leave all unchecked = any method), Upstream Scheme/Host/Port, optional Upstream Path rewrite (blank = pass the original request URI through unchanged), **Require API key** (off = the route is open to the internet with no auth at all — make sure that's intentional), optional per-route rate limit override, and optional upstream authentication (Bearer token or a named header) that rproxy presents *to the backend* — independent of whether callers need a key to reach rproxy.
3. **Add a Customer** (API Gateway → Customers → Add Customer): name, optional email (must be unique if set), enabled toggle, notes.
4. **Grant access**: on the customer's page, add an `ApiAccess` grant selecting which API, plus rate limit / daily quota / monthly quota (blank = unlimited).
5. **Generate an API key** for the customer. The plaintext key (`rpk_<prefix>_<secret>`) is shown **exactly once** — copy it immediately, it cannot be recovered afterward, only rotated (revoke + generate a new one). Optionally restrict the key to specific routes/methods.
6. Point your customer at `https://<the Api's domain><route path>` with `X-Api-Key: <the key>`.

## Rate limiting — two independent layers

1. **Static nginx ceiling** (`limit_req`) — a non-customer-aware safety cap per route, protecting the backend regardless of who's calling. Doesn't depend on the app or Redis being up.
2. **Per-customer limits** — the actual `ApiAccess`/`ApiRouteAccess` rate limit and daily/monthly quotas, enforced live via Redis. These are keyed by **customer, not by individual key** — a customer's multiple keys share one allowance, they don't multiply it.

If Redis is briefly unreachable, customer traffic is allowed through unmetered by default (the static nginx ceiling still applies) rather than taking every gateway API offline — this is `GATEWAY_REDIS_FAIL_OPEN` (see [Installation & Operations](10-installation-and-operations.md)), settable to `false` to fail closed instead.

## Analytics

Each API's Analytics tab shows allowed/denied/throttled request counts and quota utilization, refreshed every 5 minutes by a background job (not real-time). **What it can't show**: the gateway's auth check runs *before* the request reaches your backend, so it has no visibility into your backend's actual response status or latency — a request that gets past the gateway and then 500s on your server still counts as "allowed" here.

## Public developer portal

Optional, per-API: **API Gateway → (select an API) → Docs tab → Documentation settings** — toggle "Enabled" and "Public," pick a slug, and unauthenticated visitors can reach `https://<the Api's domain>/` to see rendered API documentation (endpoints, example requests, a Getting Started section you write). Turning this on serves that page directly at the gateway's own domain root — it will silently do nothing if some `ApiRoute` on that API already claims the root path (an explicit route always wins).

This is public, unauthenticated traffic hitting the same underlying app process that also serves your admin dashboard, so it's rate-limited by its own dedicated safety ceiling, separate from any route's limits.

## Self-signup endpoint

`POST /api/gateway/signup` is a machine-to-machine endpoint for provisioning free-tier customers automatically from an external site (built for a "get an API key" button on a marketing site, e.g. sleik.is) — not something reached through the admin UI. It:

- Is authenticated by a shared secret (`GATEWAY_SIGNUP_SECRET`, header `X-Gateway-Signup-Secret`), not a session or an API key.
- Grants access to exactly **one** API, fixed by the `GATEWAY_SIGNUP_API_ID` environment variable on rproxy's side — the caller can't request a different one.
- Issues a key with a fixed, low free-tier rate limit/quota (edit `signup.service.ts` to change the numbers).
- **Always creates the key scope-restricted**, allowlisting every enabled route on that API *except* any whose path falls under `GATEWAY_SIGNUP_BLOCKED_PATH_PREFIXES` (env var, comma-separated, default `/home`). A route added later is included in the allowlist automatically at the next signup unless its path happens to fall under one of the blocked prefixes — so if you add a new sensitive route tree, add its prefix to `GATEWAY_SIGNUP_BLOCKED_PATH_PREFIXES` *before* it goes live, or it will be reachable by free-tier self-signup keys by default.

This endpoint is optional and does nothing (returns 401 to every request) unless `GATEWAY_SIGNUP_SECRET` is set. See [Installation & Operations](10-installation-and-operations.md) for the full environment variable list.

## Rotate endpoint

`POST /api/gateway/rotate` is the companion endpoint for replacing a self-signup customer's key (e.g. after a suspected leak), without any admin access to rproxy. Same caller, same auth:

- Authenticated the same way as `/signup` — shared secret, header `X-Gateway-Signup-Secret`.
- Takes `{ customerId }` (the id `/signup` returned) instead of `{ uid, name, email }` — it's replacing a key for a customer that already exists, not creating one.
- Disables every currently-enabled key the customer holds and issues exactly one new one, scoped the same way `/signup` would scope a fresh key — recomputed against the *current* set of enabled routes, so a route added since the original signup (and not blocked) is picked up automatically.
- Returns 404 if `customerId` doesn't exist, or exists but has no access grant on `GATEWAY_SIGNUP_API_ID` (i.e. wasn't provisioned through `/signup` for this API).

## Troubleshooting

- **A key gets 403 on every request**: check, in order — is the `ApiKey` enabled and not revoked? Does the `Customer` have an enabled `ApiAccess` grant for that `Api`? If the key is scope-restricted, does it have an `ApiKeyRouteScope` row for that specific route?
- **A key gets 429**: this is a rate-limit or quota denial from the per-customer Redis layer — check the customer's `ApiAccess` (or a route-specific `ApiRouteAccess` override) for the actual limits, and the Analytics tab for how close to quota they are.
- **A route change isn't taking effect**: gateway config deploys (site file + the shared rate-limit-zones file) always go together in one atomic `nginx -t` + reload — if the deploy failed, nginx keeps running the previous working config rather than a half-applied one; check the deploy result shown in the UI, or `/var/log/rproxy/` and nginx's own error log.
