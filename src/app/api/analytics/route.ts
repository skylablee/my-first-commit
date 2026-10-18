import { route, dbError } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { guardFeature } from "@/lib/operations/guards";
import { adminClient } from "@/lib/server/admin";
export async function GET() {
  return route(async () => {
    const { user } = await requireUser();
    await guardFeature(user.id, "analytics");
    const { data, error } = await adminClient().rpc("user_metrics", {
      p_user_id: user.id,
    });
    dbError(error);
    return { metrics: data };
  });
}
