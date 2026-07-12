import type { AccessListUser, AccessListIpRule } from "@prisma/client";
import { sanitizeNginxValue } from "@/lib/validation";

export interface AccessListOptions {
  id: string;
  authEnabled: boolean;
  authRealm: string;
  defaultAction: string;
  authUsers: Pick<AccessListUser, "id" | "username">[];
  ipRules: Pick<AccessListIpRule, "address" | "action" | "sortOrder">[];
}

// Shared by redirect-config.ts and stream-config.ts. proxy hosts have their
// own inline copy in nginx-config.ts (older, independently tested) — not
// worth churning that file just to de-duplicate against these two newer,
// smaller consumers.
export function renderIpRuleLines(al: AccessListOptions, indent: string): string[] {
  const lines: string[] = [];
  if (al.ipRules.length > 0) {
    const sorted = [...al.ipRules].sort((a, b) => a.sortOrder - b.sortOrder);
    for (const rule of sorted) {
      const addr = sanitizeNginxValue(rule.address);
      if (addr) lines.push(`${indent}${rule.action === "allow" ? "allow" : "deny"} ${addr};`);
    }
  }
  // Always emit the catch-all, even with zero ipRules — defaultAction
  // defaults to "deny" so a freshly-attached access list with no rules
  // populated yet fails closed instead of silently allowing everyone
  // through (see nginx-config.ts for the incident this pattern fixed).
  lines.push(`${indent}${al.defaultAction === "allow" ? "allow" : "deny"} all;`);
  return lines;
}
