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
//
// The catch-all only applies when there's at least one explicit rule — the
// UI hides the default-action selector until a rule exists, so a list with
// zero ipRules has no IP restriction at all (Basic Auth, where applicable,
// still applies independently). Emitting a catch-all unconditionally here
// previously broke auth-only access lists: defaultAction defaults to
// "deny" in the DB, a value the admin never saw or chose, and it denied
// every IP outright regardless of intent.
export function renderIpRuleLines(al: AccessListOptions, indent: string): string[] {
  if (al.ipRules.length === 0) return [];
  const lines: string[] = [];
  const sorted = [...al.ipRules].sort((a, b) => a.sortOrder - b.sortOrder);
  for (const rule of sorted) {
    const addr = sanitizeNginxValue(rule.address);
    if (addr) lines.push(`${indent}${rule.action === "allow" ? "allow" : "deny"} ${addr};`);
  }
  // A denylist (rules that only deny specific addresses) with a hardcoded
  // "deny all" here would block everyone, not just the listed addresses —
  // the default action makes the catch-all match what the admin actually
  // configured.
  lines.push(`${indent}${al.defaultAction === "allow" ? "allow" : "deny"} all;`);
  return lines;
}
