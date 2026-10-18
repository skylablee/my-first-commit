import { effectivePlan } from "@/lib/operations/guards";
import { plans } from "@/lib/plans";
import { route, dbError } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
export async function GET() {
  return route(async () => {
    const { db, user } = await requireUser();
    const { data, error } = await db.rpc("usage_summary");
    dbError(error);
    const plan = await effectivePlan(user.id);
    return {
      usage: {
        ...data,
        plan,
        limit: plans[plan].limit,
        remaining: Math.max(0, plans[plan].limit - Number(data?.month ?? 0)),
      },
    };
  });
}
