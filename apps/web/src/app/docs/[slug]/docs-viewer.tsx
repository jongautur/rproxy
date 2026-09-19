"use client";

import Script from "next/script";

declare global {
  interface Window {
    Scalar?: {
      createApiReference: (selector: string, config: Record<string, unknown>) => void;
    };
  }
}

// Renders the OpenAPI document generated from the gateway config through
// Scalar's standalone API Reference bundle rather than building a bespoke
// endpoint browser UI — gives sidebar nav, method badges, grouping,
// parameters/schemas, examples, and search for free. Loaded from Scalar's
// CDN build (no @scalar/api-reference npm dependency needed).
//
// The bundle does NOT auto-init off data-* attributes — it must be told
// explicitly to mount via Scalar.createApiReference(selector, config) once
// the script has loaded, otherwise nothing renders and the page shows only
// the app shell's own dark background.
function mount(specUrl: string) {
  window.Scalar?.createApiReference("#scalar-api-reference", {
    url: specUrl,
    theme: "purple",
    darkMode: true,
  });
}

export function DocsViewer({ specUrl }: { specUrl: string }) {
  return (
    <>
      <div id="scalar-api-reference" />
      {/* onReady (not onLoad) — fires on every mount, including when the
          script is already cached from a prior page, unlike onLoad which
          only fires once per script src for the whole app lifetime. */}
      <Script
        src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"
        strategy="afterInteractive"
        onReady={() => mount(specUrl)}
      />
    </>
  );
}
