# Authentication, Users & Audit Log

## Logging in

Username or email + password. Failed attempts return a generic "Invalid username or password" regardless of whether the account exists — there's no way to tell from the response whether a username is valid, and there's no "forgot password" self-service flow; password resets for other users are an admin-only, DB-level operation today (see below).

**Rate limiting** on login is two independent windows: 20 attempts / 5 minutes per source IP, and 10 attempts / 15 minutes per account (by username). Both return `429` with a `Retry-After` header. This limiter is in-process memory, not Redis — it resets on every app restart, and if rproxy is ever run as more than one process, limits won't be shared across them. If rproxy sits behind another reverse proxy, make sure that proxy forwards `X-Forwarded-For`/`X-Real-IP` correctly, or every client will appear to share one IP for rate-limiting purposes.

### A deployment gotcha: `NEXTAUTH_URL` controls whether login cookies work at all

The session cookies' `Secure` flag is derived from whether `NEXTAUTH_URL` starts with `https://` — **not** from `NODE_ENV` or whether you're in production. If you run rproxy over plain HTTP (a LAN deployment, or a hostname with no TLS) and `NEXTAUTH_URL` is set to an `https://` URL, the cookie gets marked `Secure` and your browser will silently refuse to store it — login will appear to succeed for a moment and then bounce straight back to the login page, with no error message explaining why. Set `NEXTAUTH_URL` to match how you actually reach the app (`http://` or `https://`, matching reality) — see [Installation & Operations](10-installation-and-operations.md).

## Sessions

Two tokens: a 15-minute access token and a 7-day refresh token, both HttpOnly cookies, refreshed transparently in the background as you use the app. Independent of token expiry, every user has a `tokenVersion` that's checked on every API call — bumping it (which happens automatically on a role change or a password change) invalidates all of that user's existing sessions immediately, everywhere, even though the JWT itself is still cryptographically valid until it expires. There's no separate "log out all devices" button — a role change or password change is what triggers this.

## Roles: Admin and Viewer

Two roles only. The general rule: **Viewers can see everything, but can't change anything.** Every list/detail view (proxy hosts, certificates, redirects, streams, access lists, the API Gateway, Cloudflare/notification settings, the activity log) is readable by a Viewer; every create/edit/delete/enable/disable/trigger action across all of those requires Admin. The two self-service exceptions any logged-in user can do regardless of role: change their own password, and enroll/disable their own MFA.

**Note**: the Activity/audit log is currently viewable by Viewers too — it's not restricted to Admins. If your organization needs to keep the audit trail admin-only, that's not configurable today.

## Managing users (Settings → Users, Admin only)

- **Create**: username (3–32 chars, letters/digits/`_`/`-`), email, password (8–256 characters — no complexity requirements beyond length), and a role. New users are **not** forced to change their password on first login — that only happens for the seeded default admin account (see below). If you want a new user to pick their own password, you'll need to communicate the one you set and ask them to change it themselves under Settings.
- **Edit**: role only, via an inline dropdown. **There is no way for an admin to reset another user's password or change their username/email through the UI or API** — only the user themselves can change their own password (and only by supplying their current one). If someone is locked out, the only recovery paths are a direct database update or deleting and recreating the account.
- **Delete**: hard-deletes the user. You can't delete your own account. Their past audit log entries are kept but anonymized (shown as "system").
- **Last-admin protection**: the last remaining Admin account can't be demoted to Viewer or deleted, either by themselves or anyone else — the app always keeps at least one Admin.

### Default credentials

A fresh install seeds one admin account: **`admin` / `admin`**, with a forced password change — the app redirects every page to a "set a new password" screen until it's changed, so the default credentials can't actually be used to operate the app. Change it immediately on first login.

## Multi-Factor Authentication (TOTP)

Standard 6-digit time-based codes (30-second period), compatible with any TOTP app (Google Authenticator, Authy, Bitwarden, etc.). Set up under Settings — scan the QR code or enter the secret manually, then confirm with a live code.

On enabling MFA, you're shown **8 backup codes exactly once** — save them immediately; there is no way to view them again later. If you lose both your authenticator and your backup codes, **there is currently no admin-facing "reset this user's MFA" tool** — recovery requires a direct database edit clearing that user's TOTP fields, or deleting and recreating the account. Plan for this before rolling MFA out to users who might not have another way to reach you.

**Known limitation, verified against the current code**: the UI's backup-code screen states each code "can only be used once," but the login-time verification path does not currently mark a backup code as consumed after a successful use — a given backup code can be reused more than once in the present implementation, not strictly single-use as advertised. Treat backup codes as sensitive standing credentials (store them like a password, not a use-once slip) until this is tightened. Worth fixing in code — see note at the end of this document if you want to prioritize it.

At login, if MFA is enabled you have **2 minutes** to enter a code before the pending session expires and you have to log in again from scratch.

## Password requirements

8–256 characters, no other complexity rules enforced anywhere in the app (same rule for both self-service changes and admin-created accounts). If you want a stronger policy, it has to be enforced by convention/documentation to your users, not by the app itself.

## Audit log (Activity page)

Every create/update/delete/enable/disable/reload/cert action across the app is recorded, along with logins and logouts — visible to any logged-in user (see Roles note above). Automated actions (certificate auto-renewal, daily log cleanup) are recorded under a "system" actor rather than a real user, distinguishable in the table by an italicized "system" label instead of a username.

Entries are kept for **180 days**, pruned automatically as part of the same daily 3 AM job that also handles certificate renewal and nginx log cleanup — there's no separate schedule and no user-configurable retention period for the audit log specifically.

---

*A note on the MFA backup-code finding above: this was verified directly against `totp.service.ts` while writing this documentation (the login-time `verifyMfaCode` path calls the same check-only function used for the enrollment confirmation, with no removal step afterward) — it's a real gap between advertised and actual behavior, not a guess, and is worth a proper code fix rather than just a documentation callout if reused/leaked backup codes are a concern for your deployment.*
