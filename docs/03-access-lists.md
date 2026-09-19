# Access Lists

An Access List is a reusable set of IP rules and/or HTTP Basic Auth credentials that can be attached to any Proxy Host, Redirect Host, or Stream Host. Create one from **Access Lists → Add Access List**, then pick it from a host's form.

## Structure

- **Name** — required, unique, 1–64 characters.
- **Basic Authentication** — toggle, plus:
  - **Realm** — the text shown in the browser's login prompt (default "Restricted", max 128 characters).
  - **Users** — username (letters/digits/`.`/`_`/`@`/`-`) + password. Passwords are one-way hashed (APR1-MD5, the standard nginx htpasswd format) — **there is no way to recover or view a password once set**; to change one, delete the user and re-add them. At least one user is required if Basic Auth is on.
- **IP Access Rules** — an ordered, reorderable list of `{ address, action }`:
  - `address` must be an **IPv4** address, an IPv4 CIDR range, or the literal `"all"`. **IPv6 addresses are not supported.**
  - `action` is `allow` or `deny`. Rules are evaluated top-to-bottom.
- **Default Action** (`allow` or `deny`) — what happens to a request that matches none of the explicit rules:
  - **Deny (default)** → allowlist semantics: only the IPs you listed get through, everyone else is blocked.
  - **Allow** → denylist semantics: only the IPs you listed are blocked, everyone else gets through.

  **Important:** the Default Action only takes effect once at least one IP rule exists. An access list with **zero IP rules applies no IP restriction at all**, no matter what Default Action is stored — Basic Auth (if enabled) still applies independently. If you want an auth-only list (Basic Auth, no IP filtering), just leave the IP rules empty.

## How it applies per host type

| Host type | What gets enforced |
|---|---|
| Proxy Host | Both Basic Auth and IP rules, checked before the request is proxied to the backend. |
| Redirect Host | Both Basic Auth and IP rules, gating the redirect response itself — a denied visitor gets a 403 instead of the 301/302. |
| Stream Host | **IP rules only.** Basic Auth is meaningless with no HTTP layer and is silently ignored for streams. |

One Access List can be reused across many hosts. Editing it (users, realm, default action, IP rules) automatically redeploys and reloads nginx for every host currently using it. Deleting it detaches it from all hosts automatically and redeploys those hosts without it.

## Things to know before relying on IP rules

- **If the server sits behind Cloudflare (or any other reverse proxy), every request will appear to come from that proxy's IP**, not the real visitor — unless the separate, global **Settings → Nginx → Real Client IP** setting is enabled to trust `CF-Connecting-IP`/`X-Forwarded-For`. This is a global toggle, not per-access-list. If you're using IP allow/deny behind Cloudflare, enable Real Client IP first, or your rules will filter on Cloudflare's edge IP ranges instead of actual visitors.
- IPv4 only — no IPv6 support.
- The 403 page shown to a denied visitor can be customized globally (Proxy Hosts only) — see [Default Page & Error Pages](04-default-page-and-error-pages.md).
