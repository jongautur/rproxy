# Default Page & Custom Error Pages

Both are configured under **Settings → Nginx**.

## Default Page

Controls what a visitor sees when their request doesn't match any configured Proxy or Redirect Host — including someone hitting the server's bare IP address directly. Without this catch-all, unmatched traffic would fall through to whichever site config nginx happens to load first, potentially leaking traffic meant for one domain to an unrelated backend.

Four modes:

| Mode | Behavior |
|---|---|
| **Default nginx page** | The stock "Welcome to nginx!" page. |
| **Redirect** | HTTP 302 to a URL you provide. Must be a full `http://` or `https://` URL. |
| **Custom HTML** | Your own raw HTML (up to 200,000 characters), served as static content. |
| **No response** | nginx returns HTTP 444 and closes the connection immediately — no response body, no status line the client can parse as a normal HTTP response. Useful for reducing scanner/bot noise. |

### Things to know

- This applies to **both HTTP and HTTPS**. Since nginx needs *some* certificate to complete a TLS handshake before it can even read the SNI hostname, rproxy automatically generates a self-signed certificate the first time it's needed. **This certificate is never meant to be trusted** — if you (or a scanner) hit the server's bare IP over HTTPS, your browser will show a certificate warning. That's expected, not a misconfiguration.
- `/.well-known/acme-challenge/` is always served here too, so HTTP-01 certificate challenges work even for a domain that isn't matched by any host yet.
- Saving a Default Page setting immediately regenerates and reloads the live nginx config — no separate "publish" step.

No manual setup is required — the self-signed certificate and any static HTML are generated and written automatically.

## Custom 403 Page

Replaces nginx's stock plain-text 403 response whenever an Access List's IP rule or Basic Auth check denies a request. Leave it blank to use nginx's built-in default.

**This only applies to Proxy Hosts.** Redirect Hosts and Stream Hosts denied by their access list will still show nginx's stock 403 page even if you've set a custom one — there's currently no equivalent wiring for those host types.

### Things to know

- Saving this setting writes the HTML to a shared file and then **redeploys every single Proxy Host** so each one picks up (or drops) the `error_page 403` directive. On a server with many proxy hosts, this is a bigger operation than most settings changes — expect it to take noticeably longer than saving most other toggles, proportional to how many proxy hosts you have.
- Clearing the field reverts every proxy host back to nginx's default 403, via the same full redeploy.
