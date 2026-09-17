import { requireSession } from "@/lib/auth";
import { ApiGatewayClient } from "./components/api-gateway-client";

export const dynamic = "force-dynamic";

export default async function ApiGatewayPage() {
  await requireSession();
  return <ApiGatewayClient />;
}
