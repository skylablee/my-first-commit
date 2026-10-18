import { z } from "zod";
import { route, checkOrigin, parseBody } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { rateLimit } from "@/lib/operations/guards";
import { paymentProvider } from "@/lib/billing/provider";
import { applySubscription } from "@/lib/billing/service";
import { AppError } from "@/lib/server/errors";
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(request, "billing", user.id);
    const { subscription_id } = await parseBody(
      request,
      z.object({ subscription_id: z.string().max(100) }),
    );
    const p = paymentProvider(),
      s = await p.getSubscription(subscription_id);
    if (s.userId !== user.id)
      throw new AppError("FORBIDDEN", "내 구독만 동기화할 수 있습니다.", 403);
    await applySubscription(p, s);
    return { ok: true };
  }, "billing");
}
