// Curated directive whitelists for the "Easy mode" builder in the proxy
// form's Advanced tab. These are a subset of what validateNginxDirective
// (see validation.ts) actually allows — Easy mode intentionally offers a
// smaller, safe menu rather than every directive an admin could hand-type
// in Advanced mode.
export interface DirectivePreset {
  /** The literal nginx directive name, e.g. "proxy_set_header". */
  value: string;
  /** Human-friendly name shown in the dropdown. */
  label: string;
  /** Example value shown as the input placeholder. */
  placeholder: string;
  /** One-line explanation shown under the row once selected. */
  hint: string;
}

export const LOCATION_DIRECTIVE_PRESETS: DirectivePreset[] = [
  { value: "proxy_set_header", label: "Proxy Set Header", placeholder: "X-Real-IP $remote_addr", hint: "Sets a header forwarded to the backend." },
  { value: "add_header", label: "Add Response Header", placeholder: "X-Frame-Options DENY", hint: "Adds a header to the response sent to the client." },
  { value: "proxy_cache", label: "Proxy Cache Zone", placeholder: "my_cache", hint: "Enables caching of proxied responses using this zone." },
  { value: "proxy_cache_valid", label: "Proxy Cache Valid", placeholder: "200 10m", hint: "How long to cache responses with the given status code." },
  { value: "proxy_read_timeout", label: "Proxy Read Timeout", placeholder: "60s", hint: "Max time to wait for a response from the backend." },
  { value: "proxy_connect_timeout", label: "Proxy Connect Timeout", placeholder: "60s", hint: "Max time to establish a connection to the backend." },
  { value: "proxy_send_timeout", label: "Proxy Send Timeout", placeholder: "60s", hint: "Max time to send a request to the backend." },
  { value: "client_max_body_size", label: "Max Upload Size", placeholder: "100m", hint: "Largest request body the client may send." },
  { value: "proxy_buffering", label: "Proxy Buffering", placeholder: "on", hint: "Whether to buffer responses from the backend (on/off)." },
  { value: "try_files", label: "Try Files", placeholder: "$uri $uri/ =404", hint: "Checks files in order and uses the first one found." },
  { value: "limit_req", label: "Rate Limit", placeholder: "zone=mylimit burst=20 nodelay", hint: "Applies a request-rate limit defined elsewhere." },
  { value: "allow", label: "Allow IP", placeholder: "192.168.1.0/24", hint: "Allows requests from this IP/CIDR." },
  { value: "deny", label: "Deny IP", placeholder: "192.168.1.50", hint: "Blocks requests from this IP/CIDR." },
];

export const SERVER_DIRECTIVE_PRESETS: DirectivePreset[] = [
  { value: "error_page", label: "Custom Error Page", placeholder: "502 /502.html", hint: "Serves a custom page for the given status code." },
  { value: "client_max_body_size", label: "Max Upload Size", placeholder: "100m", hint: "Largest request body the client may send." },
  { value: "keepalive_timeout", label: "Keepalive Timeout", placeholder: "65s", hint: "How long to keep client connections open." },
  { value: "server_tokens", label: "Server Tokens", placeholder: "off", hint: "Whether nginx version info is shown in headers/errors (on/off)." },
  { value: "add_header", label: "Add Response Header", placeholder: "X-Frame-Options DENY", hint: "Adds a header to the response sent to the client." },
  { value: "proxy_set_header", label: "Proxy Set Header", placeholder: "X-Real-IP $remote_addr", hint: "Sets a header forwarded to the backend for all locations." },
  { value: "limit_conn", label: "Connection Limit", placeholder: "addr 10", hint: "Caps concurrent connections per the given key." },
  { value: "large_client_header_buffers", label: "Large Header Buffers", placeholder: "4 16k", hint: "Number and size of buffers for large client headers." },
];

/**
 * Parses a raw directive blob (one directive per line, as stored in
 * customLocations/customServer) into rows matching known presets, plus any
 * lines that don't match — those are preserved verbatim rather than
 * dropped, since Easy mode's whitelist is intentionally smaller than what
 * Advanced mode (and validateNginxDirective) actually allows.
 */
export interface DirectiveRow {
  id: string;
  directive: string;
  value: string;
}

export function parseDirectiveBlob(
  raw: string,
  presets: DirectivePreset[]
): { rows: DirectiveRow[]; leftover: string[] } {
  const rows: DirectiveRow[] = [];
  const leftover: string[] = [];
  let seq = 0;

  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      if (line) leftover.push(line);
      continue;
    }
    const withoutSemi = line.endsWith(";") ? line.slice(0, -1) : line;
    const spaceIdx = withoutSemi.indexOf(" ");
    const directiveName = spaceIdx === -1 ? withoutSemi : withoutSemi.slice(0, spaceIdx);
    const value = spaceIdx === -1 ? "" : withoutSemi.slice(spaceIdx + 1).trim();

    const preset = presets.find((p) => p.value === directiveName);
    if (preset && value) {
      rows.push({ id: `row-${seq++}-${Date.now()}`, directive: preset.value, value });
    } else {
      leftover.push(line);
    }
  }

  return { rows, leftover };
}

export function serializeDirectiveRows(rows: DirectiveRow[], leftover: string[]): string {
  const lines = rows
    .filter((r) => r.directive && r.value.trim())
    .map((r) => {
      const v = r.value.trim();
      return `${r.directive} ${v}${v.endsWith(";") ? "" : ";"}`;
    });
  return [...lines, ...leftover].join("\n");
}
