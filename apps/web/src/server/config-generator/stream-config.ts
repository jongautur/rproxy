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

export function generateStreamConfig(host: StreamHostConfig): string {
  const udp = host.protocol === "UDP" || host.protocol === "TCP_UDP";
  const tcp = host.protocol === "TCP" || host.protocol === "TCP_UDP";

  const blocks: string[] = [];

  if (tcp) {
    blocks.push(`server {
    listen ${host.listenPort};
    proxy_pass ${host.forwardHost}:${host.forwardPort};
    proxy_connect_timeout 10s;
    proxy_timeout 600s;
}`);
  }

  if (udp) {
    blocks.push(`server {
    listen ${host.listenPort} udp;
    proxy_pass ${host.forwardHost}:${host.forwardPort};
    proxy_connect_timeout 10s;
    proxy_timeout 600s;
}`);
  }

  return `# Stream host: ${host.name}\n` + blocks.join("\n\n") + "\n";
}
