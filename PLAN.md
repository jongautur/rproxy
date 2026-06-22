# rproxy — Feature Roadmap

## Design principles

- **No sidebar bloat.** The sidebar stays at 8 items. New host types live as tabs inside an existing page, not new nav entries.
- **One job per page.** Additions extend existing pages (new tabs, new dialogs) rather than multiplying pages.
- **Progressive disclosure.** Advanced settings (custom headers, stream protocol, 2FA) are hidden behind expandable sections or secondary dialogs.
- **Admin-only writes.** Every new write operation follows the existing ADMIN/VIEWER split — VIEWER users see but cannot change.
- **No feature for its own sake.** If something can already be done with custom nginx directives, it stays there.

---

## What we are NOT building (and why)

| Idea | Reason skipped |
|------|---------------|
| Load balancing | Complex to configure correctly; niche for the target audience; custom upstream blocks via directives already work |
| Per-host rate limiting | Covered by custom server directives today; a dedicated UI adds surface area without enough payoff |
| API keys | Niche; the session cookie API is sufficient for scripting with `curl -b` |
| Global nginx.conf editor | Too risky; one bad edit breaks all proxy hosts; out of scope for a GUI tool |
| Import/restore | Export already exists; import can be added later when the schema is stable |

---

## Phase 1 — Host types  
*Extends what already exists. No new sidebar items.*

### 1a. Redirect Hosts

**What:** 301/302 redirects managed as first-class objects — source domain → destination URL. SSL termination optional. Common use case: redirect bare domain to www, or redirect a retired domain to a new one.

**UI:** "Proxy Hosts" page renamed to **Hosts**. Three tabs at the top: **Proxy** | **Redirect** | **Stream** (Stream greyed out until Phase 3). Redirect tab has its own table and a "Add Redirect" dialog.

**Dialog fields:**
- Source domain (validated)
- Destination URL
- Redirect code: 301 (Permanent) / 302 (Temporary)
- Preserve path toggle (appends the request path to the destination)
- SSL on source domain (reuses existing certificate selector)

**nginx output:**
```nginx
server {
    listen 80;
    server_name old.example.com;
    return 301 https://new.example.com$request_uri;
}
```

**Schema addition:**
```prisma
model RedirectHost {
  id            String       @id @default(cuid())
  sourceDomain  String       @unique @map("source_domain")
  destination   String
  redirectCode  Int          @default(301) @map("redirect_code")
  preservePath  Boolean      @default(true) @map("preserve_path")
  sslEnabled    Boolean      @default(false) @map("ssl_enabled")
  enabled       Boolean      @default(true)
  configPath    String?      @map("config_path")
  certificate   Certificate? @relation(fields: [certificateId], references: [id])
  certificateId String?      @map("certificate_id")
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt @map("updated_at")
  @@map("redirect_hosts")
}
```

**New API routes:** `POST /api/redirects`, `PATCH /api/redirects/[id]`, `DELETE /api/redirects/[id]`, `POST /api/redirects/[id]/toggle`

---

### 1b. Custom Certificate Upload

**What:** Upload an existing cert+key pair instead of issuing via Let's Encrypt. Useful for wildcard certs issued externally, corporate CAs, or certs managed by another tool.

**UI:** On the Certificates page, the existing "Issue Certificate" button stays. A second button "Upload Certificate" opens a new dialog with three textareas: Certificate (PEM), Private Key (PEM), CA Chain (PEM, optional). On submit, the server validates the cert with OpenSSL, writes the files to `/etc/nginx/ssl/<domain>/`, and creates a Certificate record with `provider: CUSTOM`.

**Validation (server-side):** `openssl x509 -noout -text` to parse the cert, confirm key matches cert with `openssl x509 -modulus` vs `openssl rsa -modulus`, extract expiry and SANs.

**No new schema changes** — `Certificate` already has `provider: CUSTOM` and `certPath/keyPath/chainPath` fields.

---

## Phase 2 — Observability  
*Makes the system smarter about what's happening.*

### 2a. Traffic Stats

**What:** Per-proxy-host request counts, bandwidth, and error rates parsed from nginx access logs. Shown as a 24-hour sparkline on the Dashboard and a detailed breakdown on each proxy host's row (expandable) or a dedicated Stats tab within the Hosts page.

**How it works:** A new cron endpoint (`POST /api/cron/parse-logs`) runs every 5 minutes. It reads nginx access logs, parses the last window of lines (tracked via byte offset stored in Settings), and upserts hourly aggregate rows. No raw log lines stored — only aggregates.

**Schema addition:**
```prisma
model TrafficStat {
  id          String   @id @default(cuid())
  proxyHostId String   @map("proxy_host_id")
  hour        DateTime // truncated to the hour (UTC)
  requests    Int      @default(0)
  bytes       BigInt   @default(0)
  errors      Int      @default(0)  // 4xx + 5xx count
  proxyHost   ProxyHost @relation(fields: [proxyHostId], references: [id], onDelete: Cascade)
  @@unique([proxyHostId, hour])
  @@index([proxyHostId, hour(sort: Desc)])
  @@map("traffic_stats")
}
```

**Dashboard change:** Replace the placeholder stats cards with real numbers — total requests (24h), total bandwidth (24h), error rate (24h), top 5 hosts by traffic.

**Retention:** Keep 30 days of hourly rows. The existing log-cleanup cron trims `traffic_stats` older than 30 days.

---

### 2b. Notifications

**What:** Alerts sent via email (SMTP) or webhook (HTTP POST) when:
- A proxy host health check goes DOWN (and when it recovers)
- A certificate expires within N days (configurable, default: 14)
- Certificate renewal fails

**UI:** New "Notifications" section in Settings, below the existing sections. Two sub-cards:
1. **Email** — SMTP host, port, username, password (encrypted at rest same as DNS credentials), from address, to address, TLS toggle. Test button.
2. **Webhook** — URL, optional secret header (sent as `X-Webhook-Secret`). Test button.

Both channels can be active simultaneously.

**Schema addition:**
```prisma
model NotificationChannel {
  id        String   @id @default(cuid())
  type      String   // "email" | "webhook"
  enabled   Boolean  @default(true)
  config    String   // AES-256-GCM encrypted JSON (same encryptJson helper)
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@map("notification_channels")
}
```

**Trigger points:**
- Health check service: when status transitions DOWN→UP or UP→DOWN, fire notification
- Certificate renewal cron: on failure or if `expiresAt` < now + N days, fire notification

---

## Phase 3 — Security & TCP/UDP  
*Power features added once Phase 1–2 are stable.*

### 3a. Two-Factor Authentication (TOTP)

**What:** Optional TOTP (Google Authenticator, Authy, etc.) for any user account. Once enabled, login requires username + password + 6-digit code.

**UI:** Settings → Profile → Security section. "Enable 2FA" button generates a TOTP secret, shows a QR code, asks the user to confirm with a valid code before saving. "Disable 2FA" requires the current code.

**Login flow:** After password validation, if `totpEnabled` is true, return a short-lived (2 min) `mfa_pending` JWT (not an access token). The login page detects this and shows the TOTP field. The user submits the code to `POST /api/auth/mfa` which exchanges `mfa_pending` for real access + refresh tokens.

**Schema addition to User:**
```prisma
totpSecret  String?  @map("totp_secret")   // encrypted at rest
totpEnabled Boolean  @default(false) @map("totp_enabled")
```

---

### 3b. Stream Hosts (TCP/UDP)

**What:** Raw TCP/UDP proxying via the nginx `stream` module — for databases (Postgres, MySQL), game servers, MQTT brokers, etc. Not HTTP; no SSL termination via Let's Encrypt.

**UI:** The greyed-out "Stream" tab in the Hosts page becomes active. Table shows name, protocol, incoming port, forwarding target, status. "Add Stream" dialog.

**Dialog fields:**
- Name (label only)
- Protocol: TCP / UDP / TCP+UDP
- Incoming port (validated: not already in use, not 80/443/81)
- Forward host + port

**nginx output** (written to `/etc/nginx/stream.d/` via helper):
```nginx
upstream stream_abc123 {
    server 192.168.1.10:5432;
}
server {
    listen 5432;
    proxy_pass stream_abc123;
}
```

**Requires:** nginx compiled with `--with-stream` (present in `nginx-full` on Ubuntu/Debian). setup.sh updated to install `nginx-full` instead of `nginx`.

**Schema addition:**
```prisma
model StreamHost {
  id          String   @id @default(cuid())
  name        String
  protocol    String   @default("TCP")  // TCP | UDP | TCP_UDP
  listenPort  Int      @unique @map("listen_port")
  forwardHost String   @map("forward_host")
  forwardPort Int      @map("forward_port")
  enabled     Boolean  @default(true)
  configPath  String?  @map("config_path")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  @@map("stream_hosts")
}
```

---

## Version plan

| Version | Content |
|---------|---------|
| **v0.5.0** | This document — bump `package.json` version, tag the release |
| **v0.6.0** | Phase 1: Redirect Hosts + Custom Certificate Upload |
| **v0.7.0** | Phase 2: Traffic Stats + Notifications |
| **v1.0.0** | Phase 3: 2FA + Stream Hosts — stable, production-ready |

---

## Implementation order within each phase

Each phase follows this sequence to avoid half-broken states:

1. Schema changes + `prisma db push`
2. Server-side service + API routes (with tests via curl)
3. nginx config generation + helper script changes
4. UI — table/list view
5. UI — create/edit dialog
6. UI — dashboard integration (if applicable)
7. Audit log entries
8. README update

---

## Files that will change in every phase

- `prisma/schema.prisma` — new models
- `src/types/` — new TypeScript types
- `src/lib/validation.ts` — new Zod schemas
- `src/server/services/` — new service file per feature
- `src/server/config-generator/nginx-config.ts` — new config generators
- `scripts/nginx-config-helper.sh` — new case blocks for new file locations
- `sudoers/rproxy` — new allowed commands if needed
- `src/components/layout/sidebar.tsx` — rename Proxy Hosts → Hosts (Phase 1 only)

