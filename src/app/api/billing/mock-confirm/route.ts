import { checkBillingMode } from "@/lib/operations/mode";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { route, checkOrigin, parseBody } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { rateLimit } from "@/lib/operations/guards";
import { MockPaymentProvider, requirePaidPlan } from "@/lib/billing/provider";
import { applySubscription } from "@/lib/billing/service";
import { AppError } from "@/lib/server/errors";
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const p = new MockPaymentProvider();
    if ((process.env.PAYMENT_PROVIDER || "mock") !== "mock")
      throw new AppError(
        "MOCK_FORBIDDEN",
        "현재 환경에서는 mock 결제를 사용할 수 없습니다.",
        403,
      );
    const { user } = await requireUser();
    await checkBillingMode(true);
    await rateLimit(request, "billing", user.id);
    const { plan } = await parseBody(request, z.object({ plan: z.string() }));
    const s = {
      id: `mock_${randomUUID()}`,
      userId: user.id,
      plan: requirePaidPlan(plan),
      status: "active" as const,
      periodEnd: new Date(Date.now() + 30 * 86400000).toISOString(),
      cancelAtPeriodEnd: false,
    };
    await applySubscription(p, s, undefined, "subscription.created");
    return { mock: true, subscription: s };
  }, "billing");
}
