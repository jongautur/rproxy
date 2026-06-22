import { requireSession } from "@/lib/auth";
import { SystemClient } from "./components/system-client";

export const dynamic = "force-dynamic";

export default async function SystemPage() {
  await requireSession();
  return <SystemClient />;
}
