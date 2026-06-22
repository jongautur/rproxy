import { Lock, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { daysUntil } from "@/lib/utils";
import type { Certificate } from "@prisma/client";
import Link from "next/link";

export function ExpiringCerts({ certs }: { certs: Certificate[] }) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="w-4 h-4 text-warning" />
          Expiring Soon
        </CardTitle>
      </CardHeader>
      <CardContent>
        {certs.length === 0 ? (
          <div className="text-center py-6">
            <Lock className="w-8 h-8 text-success mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">All certificates are healthy</p>
          </div>
        ) : (
          <div className="space-y-3">
            {certs.map((cert) => {
              const days = cert.expiresAt ? daysUntil(cert.expiresAt) : null;
              const urgent = days !== null && days <= 7;
              return (
                <div key={cert.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{cert.domain}</p>
                    <p className="text-xs text-muted-foreground">
                      {cert.expiresAt
                        ? new Date(cert.expiresAt).toLocaleDateString()
                        : "Unknown"}
                    </p>
                  </div>
                  <Badge variant={urgent ? "destructive" : "warning"}>
                    {days !== null ? `${days}d` : "?"}
                  </Badge>
                </div>
              );
            })}
            <Link
              href="/certificates"
              className="block text-xs text-primary hover:underline mt-2"
            >
              View all certificates →
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
