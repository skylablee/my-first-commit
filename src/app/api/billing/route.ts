import { requireUser } from "@/lib/server/auth";
import { route, dbError } from "@/lib/server/api";
import { effectivePlan, rateLimit } from "@/lib/operations/guards";
import { appEnvironment } from "@/lib/environment";
import { plans } from "@/lib/plans";
export async function GET(request: Request) {
  return route(async () => {
    const { db, user } = await requireUser();
    await rateLimit(request, "billing", user.id);
    const plan = await effectivePlan(user.id);
    const [subscription, events, usage] = await Promise.all([
      db
        .from("subscriptions")
        .select(
          "plan_id,provider,status,current_period_end,cancel_at_period_end",
        )
        .eq("user_id", user.id)
        .maybeSingle(),
      db
        .from("billing_events")
        .select("id,provider,event_type,status,plan_id,amount_krw,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30),
      db.rpc("usage_summary"),
    ]);
    dbError(subscription.error);
    dbError(events.error);
    dbError(usage.error);
    return {
      plan,
      limits: plans[plan],
      subscription: subscription.data,
      events: events.data ?? [],
      usage: usage.data,
      provider: process.env.PAYMENT_PROVIDER || "mock",
      environment: appEnvironment(),
    };
  }, "billing");
}
