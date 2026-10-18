import { z } from "zod";
import { route, checkOrigin, parseBody } from "@/lib/server/api";
import { requireAdmin } from "@/lib/operations/admin";
import { rateLimit } from "@/lib/operations/guards";
import { requireStaging } from "@/lib/staging/safety";
import { checklist } from "@/lib/staging/checklist";
import { probe } from "@/lib/staging/probes";
import { services } from "@/lib/staging/types";
import { saveResult } from "@/lib/staging/results";
import { accountScenario } from "@/lib/staging/accounts";
import { queueThreadsTest, observeThreads } from "@/lib/staging/threads-test";
import { quotaAction, safeBillingScenario } from "@/lib/staging/scenarios";
export const maxDuration = 120;
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("connect"), service: z.enum(services) }),
  z.object({
    action: z.literal("accounts"),
    confirm: z.literal(true),
    email_a: z.email().max(254),
    email_b: z.email().max(254),
    password_a: z.string().min(12).max(128),
    password_b: z.string().min(12).max(128),
  }),
  z.object({
    action: z.literal("threads"),
    brand_id: z.uuid(),
    scheduled: z.boolean(),
    confirmation: z.literal("PUBLISH_STAGING_TEST"),
  }),
  z.object({ action: z.literal("threads-observe"), publication_id: z.uuid() }),
  z.object({
    action: z.enum(["limit-enable", "limit-restore", "quota-generate"]),
    user_id: z.uuid(),
    provider: z.enum(["openai", "gemini"]).default("openai"),
  }),
  z.object({
    action: z.enum([
      "billing-checkout",
      "billing-sync",
      "billing-cancel",
      "billing-upgrade-pro",
      "billing-downgrade",
      "billing-failure",
      "billing-duplicate",
    ]),
    confirmation: z.literal("SANDBOX_ONLY"),
    user_id: z.uuid().optional(),
    event_id: z.string().max(200).optional(),
  }),
]);
export async function GET() {
  return route(async () => {
    const { user } = await requireAdmin();
    return checklist(user.id);
  });
}
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user, db } = await requireAdmin();
    await requireStaging();
    await rateLimit(request, "staging", user.id);
    const input = await parseBody(request, actionSchema);
    if (input.action === "connect")
      return {
        result: await saveResult(
          user.id,
          await probe(input.service, user.id, db),
        ),
      };
    if (input.action === "accounts")
      return {
        result: await saveResult(
          user.id,
          await accountScenario(user.id, input),
        ),
      };
    if (input.action === "threads")
      return queueThreadsTest(user.id, db, input.brand_id, input.scheduled);
    if (input.action === "threads-observe") {
      const observed = await observeThreads(user.id, input.publication_id);
      if ("pending" in observed) return observed;
      return { result: await saveResult(user.id, observed) };
    }
    if (
      input.action === "limit-enable" ||
      input.action === "limit-restore" ||
      input.action === "quota-generate"
    )
      return {
        result: await saveResult(
          user.id,
          await quotaAction(
            user.id,
            input.user_id,
            input.action,
            input.provider,
          ),
        ),
      };
    const billing = await safeBillingScenario(
      user.id,
      input.action,
      input.user_id,
      "event_id" in input ? input.event_id : undefined,
    );
    if ("url" in billing) return billing;
    return { result: await saveResult(user.id, billing) };
  }, "database");
}
