import { z } from "zod";
import { route, checkOrigin, parseBody } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { rateLimit } from "@/lib/operations/guards";
import { paymentProvider, requirePaidPlan } from "@/lib/billing/provider";
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(request, "billing", user.id);
    const input = await parseBody(request, z.object({ plan: z.string() }));
    return paymentProvider().createCheckout(
      user.id,
      requirePaidPlan(input.plan),
    );
  }, "billing");
}
