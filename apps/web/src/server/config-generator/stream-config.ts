import { renderIpRuleLines, type AccessListOptions } from "./access-list-render";

interface StreamHostConfig {
  name: string;
  protocol: string;
  listenPort: number;
  forwardHost: string;
  forwardPort: number;
}

export function streamToFilename(name: string): string {
  return `stream-${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}.conf`;
}

export function generateStreamConfig(host: StreamHostConfig, accessList?: AccessListOptions | null): string {
  const udp = host.protocol === "UDP" || host.protocol === "TCP_UDP";
  const tcp = host.protocol === "TCP" || host.protocol === "TCP_UDP";

  // Raw TCP/UDP has no HTTP layer, so only IP-based rules apply here —
  // auth_basic (username/password) isn't meaningful without one.
  const accessLines = accessList ? renderIpRuleLines(accessList, "    ") : [];

  const blocks: string[] = [];

  if (tcp) {
    blocks.push(`server {
    listen ${host.listenPort};
${accessLines.map((l) => l + "\n").join("")}    proxy_pass ${host.forwardHost}:${host.forwardPort};
    proxy_connect_timeout 10s;
    proxy_timeout 600s;
}`);
  }

  if (udp) {
    blocks.push(`server {
    listen ${host.listenPort} udp;
${accessLines.map((l) => l + "\n").join("")}    proxy_pass ${host.forwardHost}:${host.forwardPort};
    proxy_connect_timeout 10s;
    proxy_timeout 600s;
}`);
  }

  return `# Stream host: ${host.name}\n` + blocks.join("\n\n") + "\n";
}
