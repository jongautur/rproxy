# Notifications & Integrations

## Notifications

**Settings → Notifications.** Three channel types — no built-in Slack/Discord/PagerDuty, though the generic Webhook channel can be pointed at a Slack/Discord incoming-webhook URL (the JSON payload shape is rproxy's own, not Slack's/Discord's, so it won't render as a native-looking message without something in between translating it).

| Channel | Fields | Notes |
|---|---|---|
| **Email (SMTP)** | Host, Port (default 587), Username, Password, From, To, TLS toggle | Auth is only attempted if a username is set, so unauthenticated relays work too. |
| **Webhook** | URL, optional Secret | POSTs `{ event, title, body, timestamp }`. If a secret is set, it's sent as the raw `X-Webhook-Secret` header value (not an HMAC signature) — the receiving end must do an exact string comparison. |
| **Home Assistant** | HA URL, Long-Lived Access Token, optional Notification Service (default `notify`, which broadcasts to every configured HA notify target — find device-specific ones under Developer Tools → Services in HA, searching "notify") | Calls HA's REST API directly. |

Each channel has its own "send for" checkbox grid — pick which of the four events it should fire on. New channels default to all four selected.

### Events

| Event | Fires when |
|---|---|
| `host_down` | A proxy host's health check **transitions** from up to down — not repeated while it stays down. |
| `host_up` | A proxy host's health check transitions from down back to up. |
| `cert_expiring` | Any **active** certificate is within 14 days of expiry — fires once per day it's checked, for every day in that window, until renewed. This includes certificates with auto-renew turned off (uploaded/custom certs) — it's the only safety net for those. |
| `cert_renewal_failed` | An auto-renew certificate's Let's Encrypt renewal attempt fails. |

**Worth knowing**: `cert_expiring` is a repeat notification, not a one-time alert — if you have a channel wired to it, expect one notification per day for two weeks before any cert expires, not just a single heads-up.

Use the **Test** button on any channel to send a synthetic notification through the real delivery path — this is the only proactive way to confirm a channel actually works; delivery failures otherwise only show up in server logs, not the UI.

Channel credentials (SMTP password, webhook secret, HA token) are encrypted at rest the same way as certificate DNS credentials — see the Security note in [Certificates](05-certificates.md#security-notes): rotating `JWT_SECRET` invalidates all of them at once.

## Cloudflare Integration

**Settings → Cloudflare.** This is the persistent integration that powers both DNS automation for Proxy Hosts/Certificates and Dynamic DNS — a separate thing from picking Cloudflare as a one-off DNS-01 challenge provider when issuing a single certificate (see [Certificates](05-certificates.md)). **All DNS automation in rproxy is Cloudflare-only** — there's no generic multi-provider DNS API integration.

Connect an API Token scoped to **Zone:DNS Edit** on the zones you want managed. rproxy verifies the token is active before accepting it — but **only that it's valid, not that it actually has permission on the specific zones you need**. A token that's active but wrongly scoped will pass the initial connection step and only fail later, with an opaque error, the first time rproxy actually tries to touch a DNS record. Double-check the token's scope in Cloudflare directly if DNS automation isn't working despite a successful "Connect."

There is only ever **one** Cloudflare connection per rproxy install — not per zone, not per account.

| Toggle | Effect |
|---|---|
| **Dynamic DNS** | Enables the DDNS sweep (below). |
| **Automatic DNS records** | New proxy hosts (and certificate issuance) auto-create/update an A record, best-effort — a Cloudflare failure here never blocks creating the host or issuing the cert. |
| **Sync existing hosts** (button) | One-time, read-only: links proxy hosts that predate the integration to their already-existing Cloudflare records by domain match. Never creates or modifies a record. |
| **Proxy new DNS records by default** | New A records start proxied (orange cloud) instead of DNS-only. |
| **Enable Cloudflare proxy after SSL is issued** | Flips a domain to proxied once its certificate goes active. |
| **Delete DNS record with host** | Deleting a proxy host also deletes the A record rproxy created for it — never touches a record it didn't create. |

Zone resolution walks a domain right-to-left against every zone the token can see (`a.b.example.com` tries `example.com`, then `b.example.com`, ...), so one token covering several zones works without manually mapping domain → zone.

**External dependency worth knowing**: rproxy detects "the server's public IP" by calling Cloudflare's own trace endpoint (`cloudflare.com/cdn-cgi/trace`). If that's unreachable (network egress blocked, Cloudflare having an outage), both auto-DNS-on-create and DDNS fail silently — logged server-side, not surfaced as an alert.

## Dynamic DNS (DDNS)

Part of the Cloudflare integration (same token, same `Dynamic DNS` toggle) — **Cloudflare is the only supported DDNS target**, there's no No-IP/DuckDNS-style provider list.

Runs every 5 minutes: checks the server's current public IP, and if it changed since the last check, updates every Cloudflare A record that was pointing at the *previous* IP. The first time it ever runs, it just records a baseline IP and does nothing else — it won't touch any records on that first run.

**Worth knowing**: it only fixes records that were already in sync with the old IP. If a record was manually pointed somewhere else, or never matched what rproxy last recorded, DDNS silently leaves it alone rather than "correcting" it back — this is a deliberate scoping choice, not a bug, but it means DDNS won't rescue a record that's drifted for other reasons.

IPv4 (A records) only — no IPv6/AAAA support.
