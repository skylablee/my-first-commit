import { route, dbError } from "@/lib/server/api";
import { paymentProvider } from "@/lib/billing/provider";
import { applySubscription } from "@/lib/billing/service";
import { AppError } from "@/lib/server/errors";
import { adminClient } from "@/lib/server/admin";
export async function POST(request: Request) {
  return route(async () => {
    const reader = request.body?.getReader();
    if (!reader) throw new AppError("WEBHOOK_BODY", "웹훅 본문이 없습니다.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 200000)
          throw new AppError("WEBHOOK_BODY", "웹훅 본문이 너무 큽니다.", 413);
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const p = paymentProvider(),
      raw = new TextDecoder().decode(Buffer.concat(chunks)),
      event = await p.handleWebhook(raw, request.headers);
    const db = adminClient();
    const delivery = await db
      .from("billing_webhook_deliveries")
      .insert({
        provider: p.name,
        provider_event_id: event.id,
        request_id: crypto.randomUUID(),
      });
    dbError(delivery.error);
    if (!event.subscriptionId) {
      const saved = await db.from("billing_events").upsert(
        {
          provider: p.name,
          provider_event_id: event.id,
          event_type: event.type,
          status: "ignored",
        },
        { onConflict: "provider,provider_event_id", ignoreDuplicates: true },
      );
      dbError(saved.error);
      return { received: true };
    }
    const existing = await db
      .from("billing_events")
      .select("status")
      .eq("provider", p.name)
      .eq("provider_event_id", event.id)
      .maybeSingle();
    dbError(existing.error);
    if (existing.data && existing.data.status !== "failed")
      return { received: true, applied: false };
    try {
      const s = await p.getSubscription(event.subscriptionId);
      const applied = await applySubscription(
        p,
        s,
        event.id,
        event.type,
        event.created,
      );
      return { received: true, applied };
    } catch (error) {
      await db.from("billing_events").upsert(
        {
          provider: p.name,
          provider_event_id: event.id,
          event_type: event.type,
          status: "failed",
          message: "제공자 구독 확인 실패 — 웹훅 재전송 필요",
        },
        { onConflict: "provider,provider_event_id", ignoreDuplicates: true },
      );
      throw error;
    }
  }, "billing");
}
