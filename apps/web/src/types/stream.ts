export interface StreamHostFormData {
  name: string;
  protocol: "TCP" | "UDP" | "TCP_UDP";
  listenPort: number;
  forwardHost: string;
  forwardPort: number;
}
