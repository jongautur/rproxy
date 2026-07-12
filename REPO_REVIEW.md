# rproxy Repository Review

This review covers the application, nginx configuration lifecycle, authentication, certificates, cron jobs, install scripts, database schema, and UI. The product has a good foundation, but it should not be exposed beyond a trusted network until the critical and high-priority findings are addressed.

## Most important problems

### 1. Critical: the service account can become root

`setup.sh` recursively gives `rproxy` ownership of `/opt/rproxy`, including `scripts/nginx-config-helper.sh`. The sudoers policy then permits `rproxy` to execute that script as root without a password.

Because `rproxy` can modify the script and subsequently run it through sudo, this is effectively unrestricted root access.

Fix this first:

- Keep the repository and helper script owned by `root:root`.
- Make the helper non-writable by `rproxy`.
- Give `rproxy` ownership only of runtime directories such as staging and application logs.
- Ideally install the privileged helper outside the writable checkout, such as `/usr/local/libexec/rproxy-nginx-helper`.
- Pin the sudoers command to that root-owned installed copy.

### 2. Critical: stored XSS through nginx logs

`apps/web/src/app/logs/components/log-viewer-client.tsx` modifies raw log strings as HTML and renders them with `dangerouslySetInnerHTML`.

Request paths, referrers, and user-agent strings are attacker-controlled. An attacker can place HTML in a log entry and have it execute when an administrator opens the log viewer.

Render logs as React text nodes. Apply status-code styling by splitting the string into text components, not by generating HTML.

### 3. High: nginx deployments are not transactional

In `apps/web/src/server/services/proxy.service.ts`:

- The config is copied into `sites-available`.
- `nginx -t` runs before a new site is enabled, meaning the new config may not be tested.
- The site is then enabled and reloaded.
- On update, the working file is overwritten before validation.
- A failed test removes the config instead of restoring the previous version.

This can silently install an untested config or destroy a working one. Redirect deployment has the same design.

Use a transaction:

- Save the existing config and symlink state.
- Stage the new config.
- Put it into the exact final include path.
- Run `nginx -t`.
- Reload only on success.
- Atomically restore the previous file and symlink on any failure.
- Update the database only after nginx reload succeeds.

### 4. High: automatic certificate renewal treats failures as success

`checkAndRenewExpiring()` ignores the `ExecResult` returned by `renewCertificate()`. That function normally returns a nonzero `exitCode`; it does not throw.

The cron path can therefore clear `renewError`, update `lastRenewAt`, and report success after a failed renewal. Check `exitCode` explicitly and reload nginx after successful installation.

### 5. High: private certificate keys receive unsafe permissions

The upload route writes temporary and final private keys using the default `writeFile` mode. Depending on the process umask, private keys may be readable by other local users. Temporary directories and keys are also never removed on success or validation failure.

Use:

- A randomly generated `mkdtemp` directory.
- Directory mode `0700`.
- Private-key mode `0600`.
- Certificate mode `0644`.
- `try/finally` cleanup.
- Strict domain validation in the upload schema.

### 6. High: stream configuration failures are ignored

`apps/web/src/server/services/stream.service.ts` calls `testNginxConfig()` and `reloadNginx()` but discards their results. Deployment helper failures are also not consistently handled.

A stream can appear successfully created in the database while nginx rejected it. Streams need the same transactional deployment mechanism as proxy and redirect hosts.

### 7. Medium: authorization trusts stale JWT claims

`apps/web/src/lib/auth.ts` accepts the role stored in an access token without confirming the current database user or role. If an admin is demoted or deleted, their existing access token can retain admin access until it expires.

Refresh tokens also have no server-side session record, revocation, reuse detection, or password-change invalidation.

Add a session/token-version field or a refresh-session table. Validate token type, issuer, audience, required claims, and current user status. Increment the token version on password or role changes.

### 8. Medium: route matching is too broad

`middleware.ts` uses `startsWith` for public paths. Paths such as `/api/auth/login-anything` are classified as public.

Use exact matches for API endpoints and explicit page-prefix rules where nesting is intended.

### 9. Medium: log statistics mishandle rotation and partial lines

In `log-parser.ts`, `offset >= fileSize` returns immediately. After rotation, a smaller replacement file never resets the offset. A line partially written at the end of a run is also discarded because the offset advances to the end anyway.

Track file identity/inode plus offset, reset on rotation, and retain an incomplete trailing line for the next parse.

### 10. Medium: access-list behavior is surprising

The nginx config generator always appends `deny all` whenever any IP rule exists. A list containing only explicit deny rules therefore denies everybody.

Define clear modes:

- Allowlist: allow selected addresses, then deny all.
- Denylist: deny selected addresses, then allow all.
- Advanced ordered rules with an explicit default action.

### 11. Medium: custom nginx directives are not safely sandboxed

The current validation is a short keyword blocklist, but the configuration generator inserts accepted lines directly into nginx configuration. Blocklists are difficult to secure and contradict the claim that there is no injection.

Prefer structured settings for supported directives. If raw configuration remains available, mark it as unsafe/admin-only, reject braces and multiline context changes, and document that administrators can break or materially alter nginx.

## Engineering improvements

The biggest maintainability problem is duplicated infrastructure logic. Proxy, redirect, stream, and access-list deployment all implement slightly different versions of “write, deploy, test, reload, rollback.”

Add:

- One transactional nginx deployment service.
- Filesystem locking so two admin requests cannot deploy simultaneously.
- Database migrations checked into the repository instead of relying on `prisma db push` in production.
- A test suite; there are currently no test/spec files.
- CI covering typecheck, lint, build, unit tests, migration validation, shell checking, and an nginx configuration integration test.
- Rate limiting for login and MFA attempts.
- CSRF/origin validation for state-changing cookie-authenticated APIs.
- Request body limits, especially certificate uploads and backup endpoints.
- Proper health/readiness endpoints for PostgreSQL, nginx, disk access, and ACME availability.
- Structured logging with request IDs and redaction.
- Secret/key rotation support instead of deriving unrelated encryption solely from `JWT_SECRET`.
- Last-admin protection so the final administrator cannot be demoted or deleted.
- Database constraints for protocol/action fields currently stored as arbitrary strings.
- Pagination and retention policies for audit and health-check tables.

The install/update path should also use immutable release directories or packaged artifacts. Allowing the live service user to own and update the source checkout makes both security and rollback considerably harder.

## Suggested roadmap

After fixing the security and deployment issues, prioritize the following work.

### 1. Safe deployment history and rollback

Show generated-config diffs, deployment status, the last known-good version, and a one-click rollback. This is the feature that most directly makes a proxy manager trustworthy.

### 2. Automated integration testing

Spin up a temporary nginx instance, generate configurations for every supported feature, run `nginx -t`, and make real HTTP, TLS, WebSocket, and gRPC requests.

### 3. Certificate reliability

Add certificate-domain matching, chain validation, renewal history, renewal dry-run, OCSP visibility, post-renew reload, and escalating expiry alerts.

### 4. Upstream pools

Add multiple upstream servers, load-balancing methods, passive health checks, backup servers, connection limits, and drain/maintenance state.

### 5. Reusable configuration policies

Add security-header profiles, timeout presets, caching profiles, WebSocket presets, body-size limits, rate limiting, trusted-proxy settings, and reusable snippets represented as structured fields.

### 6. Import, restore, and disaster recovery

There is export and database backup functionality, but operationally useful restore/import and validation workflows are missing.

### 7. Operational visibility

Add a deployment event timeline, upstream latency/error graphs, per-host bandwidth, certificate renewal history, nginx reload failures, and notification deduplication.

### 8. Authentication hardening

Add server-side sessions, revocation, recovery-code management, login lockout/backoff, optional OIDC/LDAP, and scoped roles beyond only `ADMIN` and `VIEWER`.

## Recommended order

1. Fix the sudo/root escalation.
2. Remove the log-viewer XSS.
3. Implement atomic nginx deployment and rollback.
4. Correct certificate renewal error handling.
5. Secure certificate file permissions and cleanup.
6. Add tests and CI.
7. Begin the feature roadmap.

## Verification limitation

No application files were changed during the review. Dependency installation, typechecking, and the production build could not be run because the review environment had Node.js 18 and did not have `pnpm`; the project requires Node.js 22 and pnpm 9. The findings are therefore based on static inspection.
