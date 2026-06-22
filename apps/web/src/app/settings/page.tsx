import { requireSession } from "@/lib/auth";
import { SettingsClient } from "./components/settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await requireSession();
  return <SettingsClient currentUserId={session.id} />;
}
