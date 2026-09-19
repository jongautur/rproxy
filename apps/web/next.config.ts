import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["@prisma/client"],
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    const commonSecurityHeaders = [
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-XSS-Protection", value: "1; mode=block" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    ];

    return [
      // Public developer-portal pages (/docs/[slug], see docs.service.ts and
      // docs-viewer.tsx) embed Scalar's standalone API Reference bundle from
      // its CDN — that needs script-src (and the styles/fonts/XHR it in turn
      // pulls from the same origin) opened up for cdn.jsdelivr.net. Scoped to
      // this one path so the rest of the admin app — including the
      // session-protected pages the docs pages sit next to — keeps the
      // strict policy below untouched.
      {
        source: "/docs/:path*",
        headers: [
          ...commonSecurityHeaders,
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // static.cloudflareinsights.com — Cloudflare auto-injects this
              // analytics beacon at the edge for any zone proxied through
              // it (this gateway's own domain), independent of anything
              // this app does; blocking it is harmless but noisy in the
              // console, so it's allowed here too.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
              // 'https:' (not a specific host) — docsLogoUrl is an
              // admin-entered arbitrary external URL (see
              // api-docs-settings-dialog.tsx), so the actual host isn't
              // known at config time. Admin-only field, not user-generated
              // content, so this is a deliberately looser directive scoped
              // to just this one path rather than a specific-host allowlist.
              "img-src 'self' data: blob: https:",
              // Scalar's bundle self-hosts its Inter/mono webfonts from
              // fonts.scalar.com (not jsdelivr) — blocking those isn't just
              // cosmetic: in some browsers the resulting failed font loads
              // throw during Scalar's init and it never renders any
              // operation at all ("Select an operation to view details"
              // regardless of what's clicked), rather than just falling
              // back to a system font.
              "font-src 'self' data: https://cdn.jsdelivr.net https://fonts.scalar.com",
              "connect-src 'self' https://cdn.jsdelivr.net https://fonts.scalar.com",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
      // Everything else — same negative-lookahead pattern Next.js's own docs
      // use for scoping headers away from a sub-tree (e.g. excluding /api).
      {
        source: "/((?!docs/).*)",
        headers: [
          ...commonSecurityHeaders,
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self'",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default config;
