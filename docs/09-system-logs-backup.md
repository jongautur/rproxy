# System, Logs & Backups

## System dashboard

**System** page — CPU usage/core count, load average, memory, disk usage for `/`, uptime, Node.js/nginx versions, and hostname, all read directly from `/proc` (no external monitoring agent needed). Auto-refreshes every 30 seconds. Bars turn yellow past 75% and red past 90%.

The nginx panel shows running/stopped status, active connections (not always available, depending on how nginx's status module is configured — shows `—` when it can't be read), version, and the outcome/timestamp of the last reload (persisted across app restarts, not just for the current process's lifetime).

**Test config** runs `nginx -t` without touching anything live. **Reload config** runs the same test first and only actually reloads nginx if it passes — a failing test is reported inline and nginx is left untouched. The Reload button is disabled whenever nginx isn't currently running.

## Health checks

Every enabled proxy host is probed every 2 minutes by a background cron job (independent of anyone having the Hosts page open — without it, notifications would only fire while a browser tab happened to be viewing that page). A plain HTTP HEAD request is used for `http`/`https` backends (with the real `Host` header, so name-based virtual hosting on the backend works), or a raw TCP connect check for `grpc`/`grpc"s"` backends. Any non-5xx response counts as up; a 5xx, timeout, or connection error counts as down. Only the most recent 50 checks per host are kept — this is a rolling recent-status window, not long-term trend history.

`host_down`/`host_up` notifications (see [Notifications & Integrations](08-notifications-cloudflare-ddns.md)) only fire on a **transition** — a host that's already down and stays down won't generate repeat alerts.

## Logs

**Logs** page — pick a log file (per-domain access/error logs, or the combined "All domains" log) and view it live or as a static snapshot.

- **Live mode** (default) streams new lines as they're written (polled every 2 seconds), shows a heartbeat so you can tell the connection is still alive, and detects log rotation, clearing the view with a toast when it happens.
- **Static mode** is a one-shot fetch of the last 500 lines, refreshed manually.
- Either way, the browser only ever holds the most recent **2000 lines** in memory. The filter box searches only what's currently loaded — it's a substring filter over the visible buffer, **not a historical search**; it can't find something that scrolled out of view or was never fetched.
- Lines are colorized by HTTP status family / nginx error severity, rendered as plain text (not raw HTML) specifically so a malicious request path, user-agent, or referrer captured in the log can't execute as a script in your browser.
- Download saves whatever's currently buffered, not the whole file.

### Traffic stats (behind the scenes)

A nightly job parses each proxy host's access log (only hosts with access logging on) into hourly request/byte/error-count buckets, used to drive traffic graphs elsewhere in the app. It's incremental — each run only reads new bytes since the last run — and correctly handles log rotation and a partially-written last line. Kept for 30 days.

### Log retention

**Settings → Data → Log Retention** — set a max storage cap (1–100 GB, default 10 GB) covering nginx's own logs plus rproxy's app logs together. A progress bar shows current usage, turning red past 90% of the cap.

**Important to understand before relying on this**: when cleanup runs and total usage is still over the cap after deleting every old *rotated* log file it can find, it falls back to **truncating today's live, currently-being-written log files to zero bytes**. This is a hard last-resort safety valve, not graceful rotation — any log lines written earlier that day are gone, including from traffic-stats' perspective (it can't tell "truncated" apart from "rotated," so those requests are lost from stats too, not just from the log viewer). Set the cap generously relative to your actual traffic volume; don't treat it as a precise retention window.

Cleanup runs once daily, in a fixed order, as part of the same job as certificate renewal (see below): **renew certs → clean up logs → parse logs**. Because parsing happens *after* cleanup in that order, any log bytes not yet parsed by the time cleanup runs and truncates a file are lost before the parser ever sees them.

## Backup & Export

**Settings → Data.** Two separate, download-only actions — nothing is stored server-side, and **there is currently no import/restore feature in the app** for either of them.

| | Database Backup (SQL) | Export Config (JSON) |
|---|---|---|
| **What it is** | A full `pg_dump` of the entire database | A curated, human-readable snapshot of proxy hosts, certificates (metadata only), and settings |
| **Includes secrets?** | Yes — includes encrypted credential blobs (notification channels, Cloudflare token) and password hashes, as they exist in the DB | No — explicitly excludes secrets, by design |
| **Restorable?** | Yes, manually — `psql <DATABASE_URL> < backup.sql` (it includes `DROP ... IF EXISTS` so it can be applied over an existing database) | Not directly — there's no import UI; it's meant as a readable reference/audit snapshot, not a restore mechanism |

**Neither one is a complete disaster-recovery backup on its own.** Both are missing pieces that live outside Postgres:

- Actual certificate/key files on disk (only their *paths* are recorded in the DB — the acme.sh-managed files themselves aren't included).
- Generated nginx config files on disk.
- `.env.local` — critically, `JWT_SECRET`, since every encrypted credential in the SQL backup (notification channels, Cloudflare token, DNS provider credentials) is only decryptable with the exact `JWT_SECRET` that encrypted it. **Restoring a SQL backup onto a fresh install with a different `.env.local` permanently loses access to every stored credential**, even though the encrypted blobs themselves restore fine.

If you need real disaster recovery, treat "SQL backup" + "a preserved copy of `.env.local`" as the minimum pair, and be prepared to manually re-point nginx/re-verify certificates afterward — there's no one-command restore today.

## Cron jobs (summary)

See [Installation & Operations](10-installation-and-operations.md#cron-jobs) for the full schedule and auth mechanism. The short version: certificate renewal, log cleanup, and log parsing all run **once daily at 03:00**, in that order, off a single cron entry; health checks run every 2 minutes; DDNS and API Gateway usage flush each run every 5 minutes.
