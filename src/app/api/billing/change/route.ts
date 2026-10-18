import { z } from "zod";
import { route, checkOrigin, parseBody } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { rateLimit } from "@/lib/operations/guards";
import { paymentProvider, requirePaidPlan } from "@/lib/billing/provider";
import { ownedSubscription, applySubscription } from "@/lib/billing/service";
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(request, "billing", user.id);
    const { plan } = await parseBody(request, z.object({ plan: z.string() }));
    const p = paymentProvider();
    const current = await ownedSubscription(user.id, p);
    const s = await p.changePlan(current, requirePaidPlan(plan));
    await applySubscription(p, s);
    return { subscription: s };
  }, "billing");
}
