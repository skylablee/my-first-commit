import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { externalRequest, externalJSON } from "../server/http";
import { AppError } from "../server/errors";
import { isPlan, plans, type PlanId } from "../plans";
import { appEnvironment } from "../environment";
import { secureEqual } from "../operations/crypto";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
export type SubscriptionSnapshot = {
  id: string;
  userId: string;
  plan: PlanId;
  status: "active" | "past_due" | "cancelled" | "incomplete";
  periodEnd: string;
  cancelAtPeriodEnd: boolean;
};
export type BillingEvent = {
  id: string;
  type: string;
  created: number;
  subscriptionId: string | null;
};
export type Checkout = { url: string; mock: boolean };
export interface PaymentProvider {
  readonly name: "stripe" | "mock" | "toss";
  createCheckout(userId: string, plan: PlanId): Promise<Checkout>;
  cancelSubscription(
    subscription: SubscriptionSnapshot,
  ): Promise<SubscriptionSnapshot>;
  getSubscription(id: string): Promise<SubscriptionSnapshot>;
  handleWebhook(raw: string, headers: Headers): Promise<BillingEvent>;
  changePlan(
    subscription: SubscriptionSnapshot,
    plan: PlanId,
  ): Promise<SubscriptionSnapshot>;
}
export function verifySignature(
  raw: string,
  header: string,
  secret: string,
  now = Date.now(),
) {
  if (header.length > 2048 || !secret)
    throw new AppError("WEBHOOK_SIGNATURE", "웹훅 인증에 실패했습니다.", 401);
  const parts = header.split(",");
  const t = parts.find((v) => v.startsWith("t="))?.slice(2);
  if (!t || !/^\d{10}$/.test(t) || Math.abs(now / 1000 - Number(t)) > 300)
    throw new AppError("WEBHOOK_REPLAY", "웹훅 서명이 만료되었습니다.", 401);
  const expected = createHmac("sha256", secret)
    .update(`${t}.${raw}`)
    .digest("hex");
  if (
    !parts.some((v) => v.startsWith("v1=") && secureEqual(v.slice(3), expected))
  )
    throw new AppError("WEBHOOK_SIGNATURE", "웹훅 인증에 실패했습니다.", 401);
}
const stripeSubscription = z.object({
  id: z.string(),
  metadata: z.object({ user_id: z.uuid() }),
  status: z.string(),
  cancel_at_period_end: z.boolean(),
  current_period_end: z.number().optional(),
  items: z.object({
    data: z
      .array(
        z.object({
          id: z.string(),
          current_period_end: z.number().optional(),
          quantity: z.number().optional(),
          price: z.object({
            id: z.string(),
            unit_amount: z.number().nullable(),
            currency: z.string(),
            recurring: z
              .object({ interval: z.string(), interval_count: z.number() })
              .nullable(),
          }),
        }),
      )
      .length(1),
  }),
  latest_invoice: z
    .union([z.string(), z.object({ status: z.string().nullable() })])
    .nullable()
    .optional(),
});
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  private price(plan: PlanId) {
    if (plan === "FREE")
      throw new AppError(
        "BILLING_PLAN",
        "Free로 전환하려면 구독 취소를 선택해 주세요.",
      );
    const id = process.env[`PAYMENT_PRICE_${plan}`];
    if (!id || !/^price_[a-zA-Z0-9]+$/.test(id))
      throw new AppError(
        "CONFIG_MISSING",
        `${plan} 플랜의 Stripe 가격 ID를 설정해 주세요.`,
        503,
      );
    return id;
  }
  private async call(
    path: string,
    body?: URLSearchParams,
    key?: string,
  ): Promise<unknown> {
    const secret = process.env.PAYMENT_SECRET_KEY;
    if (!secret)
      throw new AppError(
        "CONFIG_MISSING",
        "결제 서버 키를 설정해 주세요.",
        503,
      );
    const response = await externalRequest(
      `https://api.stripe.com/v1/${path}`,
      {
        method: body ? "POST" : "GET",
        headers: {
          Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
          ...(body
            ? { "Content-Type": "application/x-www-form-urlencoded" }
            : {}),
          ...(key ? { "Idempotency-Key": key } : {}),
        },
        ...(body ? { body: body.toString() } : {}),
      },
    );
    if (!response.ok)
      throw new AppError(
        "BILLING_PROVIDER",
        response.status === 429
          ? "결제 요청이 많습니다. 잠시 후 다시 시도해 주세요."
          : "결제 제공자 요청에 실패했습니다. 결제 내역을 확인한 후 다시 시도해 주세요.",
        502,
      );
    return externalJSON(response);
  }
  private async validatePrice(plan: PlanId) {
    const price = this.price(plan);
    const data = z
      .object({
        active: z.boolean(),
        unit_amount: z.number().nullable(),
        currency: z.string(),
        recurring: z
          .object({ interval: z.string(), interval_count: z.number() })
          .nullable(),
      })
      .safeParse(await this.call(`prices/${price}`));
    if (
      !data.success ||
      !data.data.active ||
      data.data.unit_amount !== plans[plan].price ||
      data.data.currency !== "krw" ||
      data.data.recurring?.interval !== "month" ||
      data.data.recurring.interval_count !== 1
    )
      throw new AppError(
        "BILLING_PRICE",
        "결제 가격의 금액·통화·주기가 플랜과 일치하지 않습니다.",
        503,
      );
  }
  async createCheckout(userId: string, plan: PlanId) {
    const price = this.price(plan),
      url = process.env.APP_URL;
    if (!url)
      throw new AppError("CONFIG_MISSING", "APP_URL을 설정해 주세요.", 503);
    const db = adminClient();
    await this.validatePrice(plan);
    const stored = await db
      .from("billing_customers")
      .select("provider_customer_id")
      .eq("user_id", userId)
      .maybeSingle();
    dbError(stored.error);
    let customerId = stored.data?.provider_customer_id as string | undefined;
    if (!customerId) {
      const created = z
        .object({ id: z.string().regex(/^cus_[a-zA-Z0-9]+$/) })
        .parse(
          await this.call(
            "customers",
            new URLSearchParams({ "metadata[user_id]": userId }),
            `biz-customer-${userId}`,
          ),
        );
      customerId = created.id;
      const mapped = await db
        .from("billing_customers")
        .upsert(
          { user_id: userId, provider_customer_id: customerId },
          { onConflict: "user_id", ignoreDuplicates: true },
        );
      dbError(mapped.error);
    }
    const customer = { id: customerId };
    // A persistent customer and provider subscription check prevent another charge if a webhook was lost.
    const existing = z
      .object({ data: z.array(z.object({ status: z.string() })) })
      .parse(
        await this.call(
          `subscriptions?customer=${customer.id}&status=all&limit=100`,
        ),
      );
    if (
      existing.data.some((s) =>
        [
          "active",
          "trialing",
          "past_due",
          "incomplete",
          "unpaid",
          "paused",
        ].includes(s.status),
      )
    )
      throw new AppError(
        "SUBSCRIPTION_EXISTS",
        "이미 결제 제공자에 구독이 있습니다. 기존 구독을 동기화하거나 플랜 변경을 이용해 주세요.",
        409,
      );
    const lock = await db.rpc("claim_checkout", {
      p_user_id: userId,
      p_plan: plan,
    });
    dbError(lock.error);
    const attempt = z
      .object({ id: z.uuid(), expires_at: z.string(), plan_id: z.string() })
      .parse(lock.data);
    if (attempt.plan_id !== plan)
      throw new AppError(
        "CHECKOUT_PENDING",
        "진행 중인 다른 플랜의 결제가 있습니다. 30분 후 다시 시도해 주세요.",
        409,
      );
    const form = new URLSearchParams({
      mode: "subscription",
      customer: customer.id,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "payment_method_types[0]": "card",
      "subscription_data[metadata][user_id]": userId,
      client_reference_id: userId,
      success_url: `${url}/?checkout=success#billing`,
      cancel_url: `${url}/?checkout=cancelled#billing`,
      expires_at: String(
        Math.floor(new Date(attempt.expires_at).getTime() / 1000),
      ),
    });
    const session = z
      .object({ url: z.url() })
      .parse(await this.call("checkout/sessions", form, attempt.id));
    if (new URL(session.url).hostname !== "checkout.stripe.com")
      throw new AppError(
        "BILLING_REDIRECT",
        "결제 이동 주소를 확인할 수 없습니다.",
        502,
      );
    return { url: session.url, mock: false };
  }
  async getSubscription(id: string) {
    if (!/^sub_[a-zA-Z0-9]+$/.test(id))
      throw new AppError("BILLING_ID", "구독 ID가 올바르지 않습니다.");
    const parsed = stripeSubscription.safeParse(
      await this.call(`subscriptions/${id}?expand[]=latest_invoice`),
    );
    if (!parsed.success)
      throw new AppError(
        "BILLING_SCHEMA",
        "구독 응답 형식을 확인하지 못했습니다.",
        502,
      );
    const data = parsed.data,
      item = data.items.data[0];
    const plan = (Object.keys(plans) as PlanId[]).find(
      (p) =>
        p !== "FREE" && process.env[`PAYMENT_PRICE_${p}`] === item.price.id,
    );
    if (
      !plan ||
      item.price.unit_amount !== plans[plan].price ||
      item.price.currency !== "krw" ||
      item.price.recurring?.interval !== "month" ||
      item.price.recurring.interval_count !== 1 ||
      (item.quantity ?? 1) !== 1
    )
      throw new AppError(
        "BILLING_PRICE",
        "결제 플랜의 가격·통화·주기를 확인해 주세요.",
        502,
      );
    const period = item.current_period_end ?? data.current_period_end;
    if (!period)
      throw new AppError(
        "BILLING_SCHEMA",
        "구독 기간을 확인할 수 없습니다.",
        502,
      );
    const paid =
      typeof data.latest_invoice === "object" &&
      data.latest_invoice?.status === "paid";
    return {
      id: data.id,
      userId: data.metadata.user_id,
      plan,
      status:
        data.status === "active" && paid
          ? "active"
          : ["canceled", "incomplete_expired"].includes(data.status)
            ? "cancelled"
            : ["past_due", "unpaid"].includes(data.status)
              ? "past_due"
              : "incomplete",
      periodEnd: new Date(period * 1000).toISOString(),
      cancelAtPeriodEnd: data.cancel_at_period_end,
    } as SubscriptionSnapshot;
  }
  async cancelSubscription(s: SubscriptionSnapshot) {
    await this.call(
      `subscriptions/${s.id}`,
      new URLSearchParams({ cancel_at_period_end: "true" }),
      `cancel-${s.id}`,
    );
    return this.getSubscription(s.id);
  }
  async changePlan(s: SubscriptionSnapshot, plan: PlanId) {
    if (s.plan === plan) return s;
    await this.validatePrice(plan);
    const raw = stripeSubscription.parse(
      await this.call(`subscriptions/${s.id}?expand[]=latest_invoice`),
    );
    const price = this.price(plan),
      upgrade = plans[plan].price > plans[s.plan].price;
    await this.call(
      `subscriptions/${s.id}`,
      new URLSearchParams({
        "items[0][id]": raw.items.data[0].id,
        "items[0][price]": price,
        proration_behavior: upgrade ? "always_invoice" : "none",
        ...(upgrade ? { payment_behavior: "pending_if_incomplete" } : {}),
      }),
      `change-${s.id}-${plan}-${randomUUID()}`,
    );
    return this.getSubscription(s.id);
  }
  async handleWebhook(raw: string, headers: Headers) {
    verifySignature(
      raw,
      headers.get("stripe-signature") ?? "",
      process.env.PAYMENT_WEBHOOK_SECRET ?? "",
    );
    const event = z
      .object({
        id: z.string().max(200),
        type: z.string().max(100),
        created: z.number().int(),
        livemode: z.boolean().default(false),
        data: z.object({ object: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(raw));
    const stage = appEnvironment();
    if (
      (stage === "production" && !event.livemode) ||
      (stage === "staging" && event.livemode)
    )
      throw new AppError(
        "WEBHOOK_MODE",
        "결제 웹훅의 환경이 서버와 일치하지 않습니다.",
        403,
      );
    const obj = event.data.object;
    let id: unknown = null;
    if (event.type.startsWith("customer.subscription.")) id = obj.id;
    else if (
      event.type === "checkout.session.completed" ||
      event.type.startsWith("invoice.")
    ) {
      id = obj.subscription;
      if (!id && obj.parent && typeof obj.parent === "object") {
        const details = (obj.parent as Record<string, unknown>)
          .subscription_details;
        if (details && typeof details === "object")
          id = (details as Record<string, unknown>).subscription;
      }
    }
    return {
      id: event.id,
      type: event.type,
      created: event.created,
      subscriptionId:
        typeof id === "string" && /^sub_[a-zA-Z0-9]+$/.test(id) ? id : null,
    };
  }
}
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";
  constructor() {
    if (!["development", "test"].includes(appEnvironment()))
      throw new AppError(
        "MOCK_FORBIDDEN",
        "운영 환경에서는 mock 결제를 사용할 수 없습니다.",
        503,
      );
  }
  async createCheckout(_userId: string, plan: PlanId) {
    return { url: `/?mock_plan=${plan}#billing`, mock: true };
  }
  async getSubscription(id: string) {
    const { data, error } = await adminClient()
      .from("subscriptions")
      .select("*")
      .eq("provider_subscription_id", id)
      .single();
    dbError(error);
    if (!data) throw new AppError("NOT_FOUND", "구독이 없습니다.", 404);
    return {
      id,
      userId: data.user_id,
      plan: data.plan_id,
      status: data.status,
      periodEnd: data.current_period_end,
      cancelAtPeriodEnd: data.cancel_at_period_end,
    } as SubscriptionSnapshot;
  }
  async cancelSubscription(s: SubscriptionSnapshot) {
    return { ...s, cancelAtPeriodEnd: true };
  }
  async changePlan(s: SubscriptionSnapshot, plan: PlanId) {
    return { ...s, plan };
  }
  async handleWebhook(raw: string, headers: Headers) {
    verifySignature(
      raw,
      headers.get("x-mock-signature") ?? "",
      process.env.PAYMENT_WEBHOOK_SECRET ?? "",
    );
    return z
      .object({
        id: z.string(),
        type: z.string(),
        created: z.number(),
        subscriptionId: z.string().nullable(),
      })
      .parse(JSON.parse(raw));
  }
}
// Toss uses billing-key authorization and its own documented webhook verification.
// Do not pretend Stripe's HMAC format works for Toss. Adapter fails closed until
// merchant-specific recurring-payment integration is implemented and certified.
export class TossPaymentProvider implements PaymentProvider {
  readonly name = "toss";
  private unavailable(): never {
    throw new AppError(
      "TOSS_NOT_CONFIGURED",
      "Toss 정기결제 어댑터는 아직 활성화되지 않았습니다. 운영 결제는 Stripe를 설정해 주세요.",
      503,
    );
  }
  async createCheckout(): Promise<Checkout> {
    return this.unavailable();
  }
  async getSubscription(): Promise<SubscriptionSnapshot> {
    return this.unavailable();
  }
  async cancelSubscription(): Promise<SubscriptionSnapshot> {
    return this.unavailable();
  }
  async changePlan(): Promise<SubscriptionSnapshot> {
    return this.unavailable();
  }
  async handleWebhook(): Promise<BillingEvent> {
    return this.unavailable();
  }
}
export function paymentProvider(): PaymentProvider {
  const type = process.env.PAYMENT_PROVIDER || "mock";
  if (type === "mock") return new MockPaymentProvider();
  if (type === "stripe") return new StripePaymentProvider();
  if (type === "toss") return new TossPaymentProvider();
  throw new AppError(
    "CONFIG_MISSING",
    "PAYMENT_PROVIDER 설정을 확인해 주세요.",
    503,
  );
}
export function requirePaidPlan(value: unknown): PlanId {
  if (!isPlan(value) || value === "FREE")
    throw new AppError("BILLING_PLAN", "유료 플랜을 선택해 주세요.");
  return value;
}
