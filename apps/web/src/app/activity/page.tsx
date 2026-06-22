import { requireSession } from "@/lib/auth";
import { ActivityClient } from "./components/activity-client";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  await requireSession();
  return <ActivityClient />;
}
