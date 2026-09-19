# Proxy Hosts

A Proxy Host maps a public domain to a backend service — the core feature of rproxy. Create one from **Proxies → Add Proxy Host**.

## Fields

| Field | Notes |
|---|---|
| **Domain Name** | Required, unique. Accepts a normal domain, a wildcard (`*.example.com`), or `localhost`. Max 253 characters. **Cannot be changed after creation** — create a new host instead. |
| **Scheme** | `http`, `https`, `grpc`, or `grpcs` — the protocol rproxy uses to talk to the backend. Default `http`. |
| **Forward Hostname / IP** | The backend target — a hostname, IPv4 address, or `localhost`. |
| **Forward Port** | 1–65535, required. |
| **Listen Port** | Port nginx listens on for plain HTTP. Default 80. |
| **HTTPS Port** | Port nginx listens on when SSL is enabled. Default 443. |
| **Enable SSL** | Turns on HTTPS — but only takes effect once a **Certificate with an actually issued cert/key** is also attached. Toggling this on without a valid certificate silently leaves the site on plain HTTP with no error. |
| **Force HTTPS** | 301-redirects all HTTP traffic to HTTPS (the ACME challenge path is exempted so renewals keep working). |
| **HTTP/2** | Only has an effect when SSL is also enabled — enabling it without SSL is a silent no-op. |
| **WebSocket Support** | Adds `Upgrade`/`Connection` header handling, applied only when the client actually sent an `Upgrade` header (not unconditionally) — this avoids breaking backends that reject a hardcoded `Connection: upgrade` on ordinary requests. |
| **Access Logging** | Per-domain access log file toggle. Regardless of this setting, every request is *also* always written to a shared `/var/log/nginx/all-access.log` — this toggle only controls the extra per-domain file. |
| **Error Logging** | Per-domain error log file toggle, on by default. |
| **Custom Location Directives** | Free-text nginx directives (one per line, max 4096 characters) injected inside the `location / { }` block. Available as a raw textarea or a curated preset dropdown (`proxy_set_header`, `add_header`, `proxy_cache`, `proxy_cache_valid`, `proxy_read_timeout`, `proxy_connect_timeout`, `proxy_send_timeout`, `client_max_body_size`, `proxy_buffering`, `try_files`, `limit_req`, `allow`, `deny`). See **Security** below for restrictions. |
| **Custom Server Directives** | Same mechanism, injected inside the `server { }` block. Preset dropdown: `error_page`, `client_max_body_size`, `keepalive_timeout`, `server_tokens`, `add_header`, `proxy_set_header`, `limit_conn`, `large_client_header_buffers`. |
| **SSL Certificate** | Dropdown of certificates from the Certificates page, with an "Issue New" shortcut. |
| **Access List** | Optional — attaches IP/Basic-Auth restrictions from an existing Access List (see [Access Lists](03-access-lists.md)). |
| **Cloudflare Proxy toggle** | Only shown when the host already has a Cloudflare-managed DNS record — flips the "orange cloud" proxied flag in place. |

## Always-on behavior (no toggle)

- Security response headers — `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-XSS-Protection`, `Referrer-Policy`, plus HSTS when SSL is on — are added to every proxy host automatically.
- `proxy_buffering off`, `proxy_request_buffering off`, and 60-second connect/send/read timeouts are hardcoded (override with a custom directive like `proxy_read_timeout` if a specific backend needs something different).
- `/.well-known/acme-challenge/` is always served, even without Force HTTPS, so Let's Encrypt issuance/renewal keeps working.
- Forwarding to an `https` (or `grpcs`) backend does **not verify the backend's TLS certificate** (`proxy_ssl_verify off` / `grpc_ssl_verify off`) and forces the outbound SNI to the proxy's own domain. This exists to work around backends that reject a mismatched SNI/Host header, but it means backend TLS here is opportunistic, not authenticated — don't rely on it to detect a spoofed/MITM'd backend on an untrusted network path.
- If **Settings → Nginx → Custom 403 Page** has content, it's automatically wired into every proxy host's config (see [Default Page & Error Pages](04-default-page-and-error-pages.md)).

## Validation

- Ports must be 1–65535. **Listen Port and HTTPS Port can't equal the port rproxy itself listens on** — the app rejects this with an explanatory error, since nginx can't bind a port the app process already owns.
- Custom Location/Server Directives: max 4096 characters each, checked against a security blocklist before anything is written to disk — see below.
- Domain must be unique across all proxy hosts.

## Security: Custom Directives

Custom Location/Server Directives are validated before they reach nginx config:

- **Rejected outright** (case-insensitive) if they contain `perl_set`, `set_by_lua`, `content_by_lua`, `access_by_lua`, `rewrite_by_lua`, any `include ` directive, or `load_module` — these could otherwise be used for arbitrary code execution or arbitrary file disclosure via nginx.
- **Braces are restricted, not banned**: any opening brace must start a well-formed `location <path> { ... }` block, every close must be a bare `}`, and nesting must return to exactly zero. This blocks tricks like closing the enclosing block early or opening an unrelated `server` block, without disallowing legitimate nested `location` blocks entirely.

Treat this field as admin-only and semi-trusted — the blocklist catches the well-known dangerous directives, but it's still raw nginx config, not a fully sandboxed DSL.

## External setup required

- **DNS**: point the domain's A/AAAA record at the server's public IP. This happens automatically only if Cloudflare Auto-DNS is enabled (see [Notifications & Integrations](08-notifications-cloudflare-ddns.md)).
- **Firewall**: allow inbound TCP on the Listen Port (default 80) and, if SSL is enabled, the HTTPS Port (default 443). Port 80 must stay reachable for HTTP-01 ACME challenges even if Force HTTPS is on.
