import { Server, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getNginxStatus } from "@/server/system/nginx";

export async function NginxStatusCard() {
  let status;
  try {
    status = await getNginxStatus();
  } catch {
    status = { running: false };
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Server className="w-4 h-4" />
            Nginx Status
          </CardTitle>
          <Badge variant={status.running ? "success" : "destructive"}>
            {status.running ? (
              <><CheckCircle2 className="w-3 h-3 mr-1" /> Running</>
            ) : (
              <><XCircle className="w-3 h-3 mr-1" /> Stopped</>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 text-sm">
          {status.running && status.activeConnections !== undefined && (
            <div className="bg-accent/50 rounded-lg p-3">
              <p className="text-muted-foreground text-xs">Active Connections</p>
              <p className="font-semibold mt-1">{status.activeConnections}</p>
            </div>
          )}
          {status.lastReload && (
            <div className="bg-accent/50 rounded-lg p-3 col-span-2">
              <p className="text-muted-foreground text-xs flex items-center gap-1">
                <RefreshCw className="w-3 h-3" /> Last Reload
              </p>
              <p className="font-semibold mt-1 text-xs">
                {new Date(status.lastReload).toLocaleString()}
                {status.lastReloadSuccess !== undefined && (
                  <span className={status.lastReloadSuccess ? "text-success ml-2" : "text-destructive ml-2"}>
                    {status.lastReloadSuccess ? "✓ Success" : "✗ Failed"}
                  </span>
                )}
              </p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
