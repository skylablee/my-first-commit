import { route, checkOrigin } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { rateLimit } from "@/lib/operations/guards";
import { paymentProvider } from "@/lib/billing/provider";
import { ownedSubscription, applySubscription } from "@/lib/billing/service";
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(request, "billing", user.id);
    const p = paymentProvider();
    const s = await p.cancelSubscription(await ownedSubscription(user.id, p));
    await applySubscription(p, s, undefined, "subscription.cancelled");
    return {
      subscription: s,
      message: "현재 이용 기간이 끝나면 Free로 전환됩니다.",
    };
  }, "billing");
}
