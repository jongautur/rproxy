# Redirect Hosts & Stream Hosts

## Redirect Hosts

A Redirect Host sends visitors of one domain to a different URL with an HTTP redirect — no proxying of content. Create one from **Proxies → Add Redirect Host**.

| Field | Notes |
|---|---|
| **Source domain** | Required, unique, domain-validated. **Cannot be changed after creation.** |
| **Destination URL** | Must be a full absolute URL (e.g. `https://example.com/path`), max 2048 characters — relative paths are rejected. |
| **Redirect type** | **301 (Permanent) or 302 (Temporary) only** — no other status codes are supported. |
| **Preserve path** | On by default. Appends the visitor's original path/query to the destination — `/blog/post` → `https://new.example.com/blog/post` instead of just `https://new.example.com`. |
| **SSL on source** | Terminates TLS on the source domain. **You must also pick a Certificate** — toggling this on without selecting one silently serves the redirect over plain HTTP only, with no error shown. |
| **Certificate** | Only selectable once SSL is enabled. |
| **Access List** | Optional. A visitor denied by the access list gets a plain 403 instead of the redirect firing. |

### Behavior worth knowing

- Redirect Hosts always bind to the standard ports **80 and 443** — there's no configurable listen port, unlike Proxy Hosts.
- When SSL is enabled, an HTTP→HTTPS redirect on port 80 is added automatically *in addition to* the real redirect served on 443, so plain-HTTP visitors get funneled to HTTPS first.
- The ACME challenge path is always served on port 80, regardless of the SSL toggle, so certificate renewal for the source domain keeps working.
- No Cloudflare auto-DNS integration — that's Proxy-Host-only. Point the source domain's DNS at the server manually.

---

## Stream Hosts

A Stream Host proxies raw TCP and/or UDP traffic — databases, SSH, game servers, mail, or anything that isn't HTTP. Create one from **Proxies → Add Stream Host**.

| Field | Notes |
|---|---|
| **Name** | Required, 1–64 characters (letters/digits/spaces/`_`/`-`), unique, **cannot be changed after creation**. |
| **Protocol** | `TCP`, `UDP`, or `TCP_UDP` (both, sharing the same listen port). |
| **Listen Port** | 1–65535. Subject to the same self-loop guard as Proxy Hosts — can't equal the port rproxy itself listens on. |
| **Forward Host / Forward Port** | The upstream target. Validation here is looser than Proxy Hosts (a basic length check, not a strict hostname/IP format check). |
| **Access List** | **IP rules only** — Basic Auth doesn't apply to raw TCP/UDP, since there's no HTTP layer to challenge. |

### What's missing compared to Proxy Hosts

Stream Hosts are intentionally minimal:

- No SSL/TLS termination — if the upstream needs TLS, it must terminate it itself.
- No Basic Auth, no custom headers, no custom directives, no HTTP/2, no WebSocket handling.
- No per-host access/error log toggle.
- Timeouts are hardcoded (10s connect, 600s idle) — not configurable.
- One stream host = one static forward target, no load-balancing pool.
- No domain/Host-header routing — a stream host claims its whole listen port; there's no SNI-based multiplexing the way HTTP virtual hosts work, so you can't put two different stream hosts on the same port.

### Behavior worth knowing

- **Disabling a stream host removes its nginx config file entirely** (rather than just symlinking it out, as Proxy/Redirect Hosts do) — the port is fully freed up while disabled, so something else could bind it in the meantime.
- Renaming a stream host removes the old config file before writing the new one.

### External setup required

- Firewall: allow inbound (and outbound, if egress-filtered) on the listen port for whichever protocol(s) you chose. No DNS is required — there's no HTTP virtual hosting involved.
