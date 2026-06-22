export interface SystemInfo {
  hostname: string;
  uptime: number;          // seconds
  loadAverage: [number, number, number];
  cpu: {
    usage: number;         // percentage 0-100
    cores: number;
  };
  memory: {
    total: number;         // bytes
    used: number;
    free: number;
    usagePercent: number;
  };
  disk: {
    total: number;         // bytes
    used: number;
    free: number;
    usagePercent: number;
  };
  nginxVersion: string;
  nodeVersion: string;
}

export interface NginxStatus {
  running: boolean;
  activeConnections?: number;
  acceptedConnections?: number;
  handledConnections?: number;
  totalRequests?: number;
  lastReload?: Date;
  lastReloadSuccess?: boolean;
  lastReloadOutput?: string;
  configTest?: {
    success: boolean;
    output: string;
  };
}
