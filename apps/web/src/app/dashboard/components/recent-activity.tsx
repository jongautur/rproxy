import { Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatRelativeTime } from "@/lib/utils";
import type { AuditLog, User } from "@prisma/client";

type LogWithUser = AuditLog & { user: Pick<User, "username"> | null };

const ACTION_COLORS: Record<string, "success" | "destructive" | "info" | "warning" | "default"> = {
  CREATE: "success",
  DELETE: "destructive",
  LOGIN: "info",
  LOGOUT: "default",
  RELOAD_NGINX: "info",
  ISSUE_CERT: "success",
  RENEW_CERT: "success",
  REVOKE_CERT: "warning",
  ENABLE: "success",
  DISABLE: "warning",
  UPDATE: "info",
};

export function RecentActivity({ logs }: { logs: LogWithUser[] }) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="w-4 h-4" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-6">No recent activity</p>
        ) : (
          <div className="space-y-3">
            {logs.map((log) => (
              <div key={log.id} className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <Badge
                    variant={ACTION_COLORS[log.action] ?? "default"}
                    className="shrink-0 mt-0.5"
                  >
                    {log.action.replace("_", " ")}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm truncate">
                      <span className="text-foreground">{log.entity}</span>
                      {log.entityId && (
                        <span className="text-muted-foreground"> #{log.entityId.slice(0, 8)}</span>
                      )}
                    </p>
                    {log.user && (
                      <p className="text-xs text-muted-foreground">by {log.user.username}</p>
                    )}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatRelativeTime(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
