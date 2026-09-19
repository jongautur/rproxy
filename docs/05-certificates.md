# Certificates

Manage TLS certificates from the **Certificates** page — issue new ones via Let's Encrypt, or upload your own. Viewing requires any logged-in role; issuing, uploading, renewing, and deleting all require **Admin**.

## Issuing a certificate (Let's Encrypt)

**Certificates → Issue Certificate.** Fields:

| Field | Notes |
|---|---|
| **Domain** | `example.com` or `*.example.com` (wildcard). |
| **ACME Account Email** | Required — used for the Let's Encrypt account. |
| **Challenge Type** | HTTP or DNS (see below). |
| **Auto-renew** | On by default — renews automatically once the cert is within 30 days of expiry (see [Renewal](#automatic-renewal) below). |

### HTTP Challenge

The simple path — no DNS provider credentials needed. Requirements, stated directly in the dialog: **nginx must be running, port 80 must be reachable from the internet, and the domain's DNS must already point at this server's IP.** If any of those aren't true yet, issuance will fail.

### DNS Challenge

Needed for wildcard certificates (`*.example.com` can't use HTTP-01 at all) or when port 80 can't be exposed. Pick a DNS provider and supply its API credentials — these are entered fresh each time you issue and are **not** the same thing as the Cloudflare integration under Settings (see below).

**Currently only these providers have credential fields in the UI**: Cloudflare, AWS Route53, GoDaddy, DigitalOcean, OVH. Namecheap, Vultr, Linode, and DuckDNS appear in the dropdown but the UI doesn't yet collect the credentials they need — issuance through those will fail. Use HTTP-01 instead if your domain supports it. "Manual DNS-01" is also listed but isn't fully wired up for an unattended flow (there's no pause-and-prompt step) — avoid it outside testing.

### After issuing

The result panel shows raw acme.sh output and, if the Cloudflare integration is active, a one-line summary of what DNS automation did (see below). A failed issuance leaves the certificate in an `ERROR` state with the failure detail visible in the table's expandable row — nothing partially-working goes live.

## Uploading your own certificate

**Certificates → Upload Certificate.** Paste the domain, the certificate PEM, the private key PEM, and optionally a CA chain (if omitted, the certificate itself is used as the fullchain). Uploaded certificates:

- Are marked `CUSTOM` and **never auto-renew** — you're responsible for replacing them before they expire.
- Still get expiry-warning notifications (see below) even though they're not auto-renewed — that's the one safety net for manually-managed certs.
- Are validated before being accepted: the cert and key must actually parse and match each other, or the upload is rejected.

## Renewing and deleting

- **Renew now** (the refresh icon) is only available for active Let's Encrypt certificates — not for uploaded or pending ones. It force-renews immediately, regardless of how close to expiry the cert actually is.
- **Delete** is blocked — both in the UI and enforced server-side — if the certificate is still attached to any Proxy Host, Redirect Host, or API Gateway `Api`. Detach it from every host first.

## Automatic renewal

A daily cron job (03:00 server time) renews every certificate that's Let's Encrypt-issued, currently active, has auto-renew on, and is within **30 days** of expiry. A failed renewal is recorded as a real failure (not silently treated as success) and fires a notification if you have a notification channel configured for it.

Separately, **any** active certificate — including manually-managed uploaded ones — gets an expiry-warning notification once it's within **14 days** of expiry, repeated on each daily run until it's renewed or replaced (there's no de-duplication, so expect one notification per day in that window if you have alerts configured).

## Cloudflare DNS automation

This is a different thing from picking "Cloudflare" as a DNS-01 challenge provider on a single issuance — this is a persistent integration, configured once under **Settings → Cloudflare**, that can automatically manage DNS records as part of the certificate and proxy-host lifecycle.

**Setup**: create a Cloudflare API Token (not the legacy Global API Key) scoped to **Zone:DNS Edit** on whichever zones you want rproxy to manage, and paste it into the Cloudflare tab. rproxy verifies the token against Cloudflare before saving — an invalid or under-scoped token is rejected immediately with an explanation, not silently stored.

Relevant toggles:

| Toggle | Effect |
|---|---|
| **Automatic DNS records** | When on, issuing a certificate (or creating a proxy host) automatically creates/updates the matching A record. This is the toggle that actually affects certificate issuance. |
| **Proxy new DNS records by default** | New A records rproxy creates start DNS-only (grey cloud) unless this is on. |
| **Enable Cloudflare proxy after SSL is issued** | Once a certificate for a domain goes active, flips that domain's record to proxied (orange cloud) automatically, even if it started DNS-only. |
| **Delete DNS record with host** | When a proxy host is deleted, also deletes the A record rproxy created for it. |

**Important**: the DNS automation step is entirely best-effort — if Cloudflare is slow, misconfigured, or the token lacks permission for a particular zone, certificate issuance still proceeds without it. You'll see the DNS step's own success/failure in the result panel, separate from whether the certificate itself was issued.

**A gotcha worth knowing**: if a domain's Cloudflare record is proxied (orange cloud) *before* you issue an HTTP-01 certificate for it, the HTTP-01 challenge request from Let's Encrypt will hit Cloudflare's edge, not your server directly — this can cause HTTP-01 issuance to fail. Use DNS-01, or make sure the record is DNS-only (grey cloud) during issuance.

## Security notes

- DNS provider credentials (entered per-issuance) and the Cloudflare integration token are both encrypted at rest (AES-256-GCM), with the encryption key derived from `JWT_SECRET`. **Rotating `JWT_SECRET` invalidates every previously stored encrypted credential** — DNS credentials, the Cloudflare token, and notification channel configs would all need to be re-entered.
- Uploaded private keys are written with `0600` permissions (owner-read/write only); the certificate itself is `0644`. Temporary files used to validate an upload before accepting it are created in a `0700` directory and always deleted afterward, success or failure.
- All certificate operations (openssl parsing, acme.sh invocation, writing into `/etc/nginx/ssl/`) go through the same privilege-boundary mechanism as the rest of rproxy — see [Installation & Operations](10-installation-and-operations.md#security-model-for-anyone-auditing-or-extending-this).
