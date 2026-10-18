import "server-only";
import { randomUUID } from "node:crypto";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
import { type PaymentProvider, type SubscriptionSnapshot } from "./provider";
import { AppError } from "../server/errors";
export async function applySubscription(
  provider: PaymentProvider,
  s: SubscriptionSnapshot,
  eventId = `sync_${randomUUID()}`,
  eventType = "subscription.updated",
  at = Date.now() / 1000,
) {
  const { data, error } = await adminClient().rpc("apply_billing_event", {
    p_provider: provider.name,
    p_event_id: eventId,
    p_type: eventType,
    p_user_id: s.userId,
    p_plan: s.plan,
    p_subscription_id: s.id,
    p_status: s.status,
    p_period_end: s.periodEnd,
    p_cancel: s.cancelAtPeriodEnd,
    p_event_at: new Date(at * 1000).toISOString(),
    p_amount: null,
  });
  dbError(error);
  return data;
}
export async function ownedSubscription(
  userId: string,
  provider: PaymentProvider,
) {
  const { data, error } = await adminClient()
    .from("subscriptions")
    .select("provider_subscription_id,provider")
    .eq("user_id", userId)
    .maybeSingle();
  dbError(error);
  if (
    !data ||
    data.provider !== provider.name ||
    !data.provider_subscription_id
  )
    throw new AppError("NOT_FOUND", "현재 제공자의 구독이 없습니다.", 404);
  const snapshot = await provider.getSubscription(
    data.provider_subscription_id,
  );
  if (snapshot.userId !== userId)
    throw new AppError("FORBIDDEN", "구독 소유권을 확인할 수 없습니다.", 403);
  return snapshot;
}
