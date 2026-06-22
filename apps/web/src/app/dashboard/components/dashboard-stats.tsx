import { Globe, CheckCircle2, XCircle, Lock, AlertTriangle, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Props {
  proxies: { total: number; active: number; disabled: number; error: number; down: number };
  certs: { total: number; active: number; expired: number; expiring: number };
}

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ElementType;
  iconClass: string;
  subLabel?: string;
  subValue?: number;
  subClass?: string;
}

function StatCard({ label, value, icon: Icon, iconClass, subLabel, subValue, subClass }: StatCardProps) {
  return (
    <Card className="hover:border-border/80 transition-colors">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value}</p>
            {subLabel && subValue !== undefined && (
              <p className={cn("text-xs mt-1", subClass ?? "text-muted-foreground")}>
                {subValue} {subLabel}
              </p>
            )}
          </div>
          <div className={cn("w-11 h-11 rounded-xl flex items-center justify-center", iconClass)}>
            <Icon className="w-5 h-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function DashboardStats({ proxies, certs }: Props) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        label="Total Proxies"
        value={proxies.total}
        icon={Globe}
        iconClass="bg-primary/10 text-primary"
        subLabel="active"
        subValue={proxies.active}
        subClass="text-success"
      />
      <StatCard
        label="Online"
        value={proxies.active}
        icon={CheckCircle2}
        iconClass="bg-success/10 text-success"
        subLabel="disabled"
        subValue={proxies.disabled}
        subClass="text-muted-foreground"
      />
      <StatCard
        label="Down"
        value={proxies.down}
        icon={proxies.down > 0 ? AlertTriangle : CheckCircle2}
        iconClass={proxies.down > 0 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"}
        subLabel={proxies.error > 0 ? "deploy errors" : undefined}
        subValue={proxies.error > 0 ? proxies.error : undefined}
        subClass="text-destructive"
      />
      <StatCard
        label="SSL Certs"
        value={certs.total}
        icon={Lock}
        iconClass="bg-primary/10 text-primary"
        subLabel={certs.expiring > 0 ? "expiring soon" : "active"}
        subValue={certs.expiring > 0 ? certs.expiring : certs.active}
        subClass={certs.expiring > 0 ? "text-warning" : "text-success"}
      />
    </div>
  );
}
