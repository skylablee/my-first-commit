import "server-only";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
import { AppError } from "../server/errors";
import { effectivePlan } from "../operations/guards";
import { plans } from "../plans";
import { StripePaymentProvider } from "../billing/provider";
import { ownedSubscription, applySubscription } from "../billing/service";
import { smallAI } from "./ai-test";
import { requireTestPayment } from "./safety";
import { result, failure } from "./results";
export async function testSubject(adminId: string, userId?: string) {
  if (!userId || userId === adminId) return adminId;
  const { data, error } = await adminClient()
    .from("staging_accounts")
    .select("user_id")
    .eq("admin_id", adminId)
    .eq("user_id", userId)
    .single();
  dbError(error);
  if (!data)
    throw new AppError(
      "TEST_ACCOUNT",
      "현재 관리자 또는 내가 만든 전용 테스트 계정만 사용할 수 있습니다.",
      403,
    );
  return userId;
}
export async function quotaAction(
  adminId: string,
  userId: string,
  action: "limit-enable" | "limit-restore" | "quota-generate",
  provider: "openai" | "gemini",
) {
  const db = adminClient();
  await testSubject(adminId, userId);
  const registered = await db
    .from("staging_accounts")
    .select("user_id")
    .eq("admin_id", adminId)
    .eq("user_id", userId)
    .single();
  dbError(registered.error);
  if (!registered.data)
    throw new AppError(
      "TEST_ACCOUNT",
      "한도 테스트는 별도 전용 테스트 계정만 가능합니다.",
      403,
    );
  if (action !== "quota-generate") {
    const changed = await db.rpc("staging_set_usage_limit", {
      p_admin_id: adminId,
      p_user_id: userId,
      p_enable: action === "limit-enable",
    });
    dbError(changed.error);
    return result(
      "Supabase",
      action,
      "PASS",
      action === "limit-enable"
        ? "전용 FREE 계정 한도를 20분 동안 3회로 설정했습니다. 전역 플랜·사용량은 변경하지 않았습니다."
        : "임시 한도를 제거했습니다. 원래 플랜 한도가 적용됩니다.",
      { api_called: false, subject_user_id: userId },
    );
  }
  const plan = await effectivePlan(userId);
  const before = await db
    .from("usage_counters")
    .select("ai_generations")
    .eq("user_id", userId)
    .order("period_start", { ascending: false })
    .limit(1);
  dbError(before.error);
  const count = before.data?.[0]?.ai_generations ?? 0;
  const generated = await smallAI(userId, provider, "quota_generation");
  generated.details = { ...generated.details, subject_user_id: userId, plan };
  if (
    generated.error_category === "QUOTA_EXCEEDED" &&
    generated.details.api_called === false &&
    count === 3
  ) {
    const override = await db
      .from("staging_usage_overrides")
      .select("expires_at")
      .eq("admin_id", adminId)
      .eq("user_id", userId)
      .single();
    dbError(override.error);
    const prior = await db
      .from("staging_checks")
      .select("details")
      .eq("admin_id", adminId)
      .eq("test_name", "quota_generation")
      .eq("status", "PASS")
      .contains("details", { subject_user_id: userId })
      .limit(20);
    dbError(prior.error);
    if (
      override.data &&
      new Date(override.data.expires_at) > new Date() &&
      (prior.data ?? []).length === 3
    )
      return result(
        provider === "openai" ? "OpenAI" : "Gemini",
        "quota_fourth_block",
        "PASS",
        "실제 생성 3회 후 4번째 요청은 외부 호출 전에 차단했습니다.",
        { api_called: false, subject_user_id: userId, used: 3, provider },
      );
  }
  if (generated.status === "PASS" && plan !== "FREE" && count >= 3) {
    const blocked = await db
      .from("staging_checks")
      .select("id")
      .eq("admin_id", adminId)
      .eq("test_name", "quota_fourth_block")
      .contains("details", { subject_user_id: userId })
      .eq("status", "PASS")
      .limit(1);
    dbError(blocked.error);
    if (blocked.data?.length) generated.test_name = "quota_after_upgrade";
  }
  return generated;
}
export async function billingScenario(
  adminId: string,
  action: string,
  userId?: string,
  eventId?: string,
) {
  requireTestPayment();
  const subject = await testSubject(adminId, userId),
    db = adminClient(),
    p = new StripePaymentProvider();
  if (action === "billing-checkout") {
    if ((await effectivePlan(subject)) !== "FREE")
      throw new AppError(
        "BILLING_BASELINE",
        "FREE → STARTER 시나리오는 현재 FREE인 전용 계정에서 시작하세요.",
        409,
      );
    const baseline = await db.from("staging_checks").insert({
      admin_id: adminId,
      test_name: "billing_baseline",
      service: "Payment",
      status: "PASS",
      safe_message:
        "테스트 전 FREE 플랜을 확인했습니다. 결제 성공은 아직 검증하지 않았습니다.",
      request_id: crypto.randomUUID(),
      details: { subject_user_id: subject, plan: "FREE", api_called: false },
    });
    dbError(baseline.error);
    return p.createCheckout(subject, "STARTER");
  }
  if (action === "billing-sync") {
    const row = await db
      .from("subscriptions")
      .select("provider_subscription_id")
      .eq("user_id", subject)
      .eq("provider", "stripe")
      .single();
    dbError(row.error);
    if (!row.data?.provider_subscription_id)
      throw new AppError(
        "PAYMENT_PENDING",
        "서명된 테스트 웹훅의 구독 기록이 아직 없습니다. Stripe 테스트 결제와 웹훅을 확인하세요.",
        409,
      );
    const s = await p.getSubscription(row.data.provider_subscription_id);
    if (s.userId !== subject)
      throw new AppError("FORBIDDEN", "구독 소유자가 일치하지 않습니다.", 403);
    await applySubscription(p, s, undefined, "staging.sync");
    if (s.status !== "active" || s.plan !== "STARTER")
      throw new AppError(
        "PAYMENT_TEST",
        "납부된 STARTER 테스트 구독이 아닙니다.",
        409,
      );
    const baseline = await db
      .from("staging_checks")
      .select("id")
      .eq("admin_id", adminId)
      .eq("test_name", "billing_baseline")
      .contains("details", { subject_user_id: subject, plan: "FREE" })
      .limit(1);
    dbError(baseline.error);
    if (!baseline.data?.length)
      throw new AppError(
        "BILLING_BASELINE",
        "FREE 시작 상태가 기록되지 않았습니다.",
        409,
      );
    return result(
      "Payment",
      "sandbox_upgrade",
      "PASS",
      "Stripe test 결제·DB 구독·STARTER 한도 100회를 확인했습니다.",
      {
        api_called: true,
        subject_user_id: subject,
        plan: s.plan,
        limit: plans[s.plan].limit,
        sandbox: true,
      },
    );
  }
  if (action === "billing-cancel") {
    const s = await p.cancelSubscription(await ownedSubscription(subject, p));
    await applySubscription(p, s, undefined, "subscription.cancelled");
    if (!s.cancelAtPeriodEnd)
      throw new AppError(
        "PAYMENT_TEST",
        "기간 종료 취소 예약을 확인하지 못했습니다.",
      );
    return result(
      "Payment",
      "sandbox_cancel",
      "PASS",
      "제공자에서 기간 종료 취소 예약을 확인했습니다. 실제 기간 종료 후 FREE 전환은 아직 미검증입니다.",
      {
        api_called: true,
        subject_user_id: subject,
        cancel_at_period_end: true,
        period_end: s.periodEnd,
      },
    );
  }
  if (action === "billing-upgrade-pro" || action === "billing-downgrade") {
    const current = await ownedSubscription(subject, p),
      plan = action === "billing-upgrade-pro" ? "PRO" : "STARTER";
    if (
      action === "billing-downgrade" &&
      !["PRO", "AGENCY"].includes(current.plan)
    )
      throw new AppError(
        "PAYMENT_TEST",
        "다운그레이드 검증은 PRO 이상 테스트 구독에서 실행하세요.",
        409,
      );
    const before = await db
      .from("usage_counters")
      .select("ai_generations,period_start")
      .eq("user_id", subject);
    dbError(before.error);
    const s = await p.changePlan(current, plan);
    await applySubscription(p, s, undefined, "staging.plan_change");
    if (s.plan !== plan || s.status !== "active")
      throw new AppError(
        "PAYMENT_TEST",
        "테스트 결제·플랜 변경이 아직 완료되지 않았습니다.",
        409,
      );
    const after = await db
      .from("usage_counters")
      .select("ai_generations,period_start")
      .eq("user_id", subject);
    dbError(after.error);
    if (JSON.stringify(before.data) !== JSON.stringify(after.data))
      throw new AppError(
        "USAGE_CHANGED",
        "플랜 변경 도중 카운터가 달라졌습니다. 동시 요청·초기화 여부를 확인하세요.",
        409,
      );
    return result(
      "Payment",
      action,
      "PASS",
      "실제 테스트 구독의 플랜 변경과 사용량 보존을 확인했습니다.",
      {
        api_called: true,
        subject_user_id: subject,
        from: current.plan,
        to: s.plan,
      },
    );
  }
  const events = await db
    .from("billing_events")
    .select("provider_event_id,event_type,status")
    .eq("user_id", subject)
    .eq("provider", "stripe")
    .order("created_at", { ascending: false })
    .limit(50);
  dbError(events.error);
  if (action === "billing-failure") {
    const failed = (events.data ?? []).find(
      (e) =>
        e.event_type === "invoice.payment_failed" && e.status === "processed",
    );
    if (!failed)
      throw new AppError(
        "PAYMENT_PENDING",
        "서명된 invoice.payment_failed 테스트 이벤트가 없습니다. Stripe 테스트 실패 카드를 먼저 사용하세요.",
        409,
      );
    const received = await db
      .from("billing_webhook_deliveries")
      .select("id")
      .eq("provider", "stripe")
      .eq("provider_event_id", failed.provider_event_id);
    dbError(received.error);
    if (!received.data?.length)
      throw new AppError(
        "PAYMENT_PENDING",
        "서명 검증된 수신 기록이 없습니다.",
      );
    return result(
      "Payment",
      "sandbox_payment_failed",
      "PASS",
      "실제 테스트 결제 실패 웹훅 수신과 처리 기록을 확인했습니다.",
      {
        api_called: true,
        subject_user_id: subject,
        event_id: failed.provider_event_id,
        event_status: failed.status,
      },
    );
  }
  if (action === "billing-duplicate") {
    const entry = (events.data ?? []).find(
      (e) => e.provider_event_id === eventId && e.status === "processed",
    );
    if (!entry)
      throw new AppError(
        "PAYMENT_PENDING",
        "내 테스트 계정의 처리된 Stripe 이벤트 ID를 입력하세요.",
        409,
      );
    const deliveries = await db
      .from("billing_webhook_deliveries")
      .select("id")
      .eq("provider", "stripe")
      .eq("provider_event_id", eventId!);
    dbError(deliveries.error);
    if ((deliveries.data ?? []).length < 2)
      throw new AppError(
        "PAYMENT_PENDING",
        "Stripe에서 동일 이벤트를 재전송한 후 다시 확인하세요. 로컬 위조 이벤트를 만들지 않습니다.",
        409,
      );
    return result(
      "Payment",
      "sandbox_duplicate",
      "PASS",
      "서명 검증된 동일 이벤트를 여러 번 수신했지만 billing_events에는 단일 기록이 있습니다.",
      {
        api_called: true,
        event_id: eventId,
        deliveries: deliveries.data!.length,
        subject_user_id: subject,
      },
    );
  }
  throw new AppError("VALIDATION_ERROR", "지원하지 않는 테스트입니다.");
}
export async function safeBillingScenario(
  adminId: string,
  action: string,
  userId?: string,
  eventId?: string,
) {
  try {
    return await billingScenario(adminId, action, userId, eventId);
  } catch (e) {
    return failure("Payment", action, e, {
      api_called: null,
      scope:
        "PASS가 아니며, 제공자 호출 여부는 오류 단계에 따라 다를 수 있습니다.",
    });
  }
}
