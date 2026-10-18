import { route } from "@/lib/server/api";
import { configurationStatus } from "@/lib/server/env";
// Only names and booleans. This endpoint intentionally works before login to unblock setup.
export async function GET() {
  return route(async () => configurationStatus());
}
