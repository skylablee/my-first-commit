import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
import { AppError } from "../server/errors";
import { externalRequest, externalJSON } from "../server/http";
import { result, failure } from "./results";
import { smallAI } from "./ai-test";
import { serviceConfiguration } from "./config";
import { MetaThreadsProvider } from "../threads/provider";
import { decrypt } from "../operations/crypto";
import { plainText, safeLink } from "../providers/news";
import { requireTestPayment } from "./safety";
import type { StagingService } from "./types";
export async function probe(
  service: StagingService,
  userId: string,
  sessionDb: SupabaseClient,
) {
  const configured = serviceConfiguration().find((s) => s.name === service)!;
  if (configured.missing.length)
    return result(
      service,
      "connect",
      "NOT CONFIGURED",
      "환경변수가 부족해 실연결을 실행하지 않았습니다.",
      { missing: configured.missing, api_called: false },
    );
  if (service === "OpenAI" || service === "Gemini")
    return smallAI(userId, service === "OpenAI" ? "openai" : "gemini");
  const start = Date.now();
  let called = false;
  try {
    const db = adminClient();
    let details: Record<string, unknown> = {};
    if (service === "Supabase") {
      called = true;
      const auth = await sessionDb.auth.getUser();
      if (auth.error || auth.data.user?.id !== userId)
        throw new AppError(
          "AUTH_TEST",
          "현재 관리자 인증을 검증하지 못했습니다.",
          401,
        );
      const checks = await db.rpc("staging_schema_status");
      dbError(checks.error);
      const schema = z
        .object({
          versions: z.array(z.string()),
          tables: z.array(
            z.object({
              name: z.string(),
              exists: z.boolean(),
              rls: z.boolean(),
              policies: z.number(),
            }),
          ),
          token_select_blocked: z.boolean(),
          usage_write_blocked: z.boolean(),
          quota_function_current: z.boolean(),
        })
        .parse(checks.data);
      if (
        !schema.versions.includes("003_phase35_staging_validation") ||
        schema.tables.some((t) => !t.exists || !t.rls || t.policies === 0) ||
        !schema.token_select_blocked ||
        !schema.usage_write_blocked ||
        !schema.quota_function_current
      )
        throw new AppError(
          "SCHEMA_TEST",
          "마이그레이션·RLS·서버 전용 권한 검사에 실패했습니다.",
          409,
        );
      const profile = await sessionDb
        .from("profiles")
        .select("id")
        .eq("id", userId)
        .single();
      dbError(profile.error);
      details = {
        ...schema,
        auth_validated: true,
        profile_present: Boolean(profile.data),
        scope:
          "DB·현재 관리자 Auth·RLS 설정 검사. 두 사용자 RLS 동작은 별도 계정 테스트에서 확인합니다.",
      };
    } else if (service === "Naver") {
      const url =
        "https://openapi.naver.com/v1/search/news.json?query=%EC%BB%A4%ED%94%BC&display=3&sort=date";
      called = true;
      const r = await externalRequest(url, {
        headers: {
          "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID!,
          "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET!,
        },
      });
      if (!r.ok)
        throw new AppError(
          r.status === 401
            ? "NAVER_AUTH"
            : r.status === 429
              ? "NAVER_RATE"
              : "NAVER_ERROR",
          "네이버 뉴스 API 요청이 실패했습니다.",
          502,
        );
      const parsed = z
        .object({
          items: z
            .array(
              z.object({
                title: z.string(),
                originallink: z.string(),
                link: z.string(),
                pubDate: z.string(),
              }),
            )
            .max(3),
        })
        .parse(await externalJSON(r));
      details = {
        query: "커피",
        items: parsed.items.map((i) => ({
          title: plainText(i.title),
          source: safeLink(i.originallink || i.link)
            ? new URL(i.originallink || i.link).hostname
            : "출처 없음",
          date: i.pubDate,
        })),
      };
    } else if (service === "Threads") {
      const c = await db
        .from("social_connections")
        .select("provider_user_id,username,access_token_encrypted,expires_at")
        .eq("user_id", userId)
        .eq("provider", "threads")
        .maybeSingle();
      dbError(c.error);
      if (!c.data)
        return result(
          service,
          "connect",
          "NOT CONFIGURED",
          "아직 OAuth 계정이 연결되지 않았습니다.",
          { api_called: false },
        );
      if (!c.data.access_token_encrypted.startsWith("v1."))
        throw new AppError(
          "TOKEN_STORAGE",
          "토큰 암호화 저장 형식이 올바르지 않습니다.",
          409,
        );
      if (new Date(c.data.expires_at).getTime() < Date.now())
        throw new AppError(
          "TOKEN_EXPIRED",
          "연결 토큰이 만료되었습니다. OAuth를 다시 연결하세요.",
          409,
        );
      const token = decrypt(c.data.access_token_encrypted, `threads:${userId}`);
      called = true;
      const current = await new MetaThreadsProvider().profile(token);
      if (current.id !== c.data.provider_user_id)
        throw new AppError(
          "THREADS_IDENTITY",
          "연결 사용자 ID가 일치하지 않습니다.",
          409,
        );
      details = {
        username: current.username,
        encrypted_storage: true,
        expires_at: c.data.expires_at,
        scope: "OAuth 계정·암호화 저장·실제 /me 조회. 게시 성공과 구분합니다.",
      };
    } else if (service === "Payment") {
      requireTestPayment();
      called = true;
      const r = await externalRequest("https://api.stripe.com/v1/balance", {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.PAYMENT_SECRET_KEY}:`).toString("base64")}`,
        },
      });
      if (!r.ok)
        throw new AppError(
          "PAYMENT_TEST_AUTH",
          "Stripe test 계정 조회에 실패했습니다.",
          502,
        );
      const body = z
        .object({ livemode: z.boolean() })
        .parse(await externalJSON(r));
      if (body.livemode)
        throw new AppError(
          "LIVE_PAYMENT_BLOCKED",
          "실결제 모드 응답이므로 테스트를 중단했습니다.",
          403,
        );
      details = {
        provider: "stripe",
        sandbox: true,
        scope:
          "test 계정 읽기 연결. Checkout·청구·웹훅은 별도 시나리오가 필요합니다.",
      };
    } else {
      const origin = process.env.APP_URL!;
      if (origin !== new URL(origin).origin)
        throw new AppError(
          "APP_URL",
          "APP_URL은 경로 없는 origin이어야 합니다.",
        );
      called = true;
      const r = await externalRequest(`${origin}/api/cron/publish?probe=1`, {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      if (!r.ok)
        throw new AppError(
          "CRON_TEST",
          "배포된 Cron 인증 점검에 실패했습니다.",
          502,
        );
      const body = z
        .object({
          probe: z.literal(true),
          deployment_reachable: z.literal(true),
          scheduler_invoked: z.literal(false),
        })
        .parse(await externalJSON(r));
      details = {
        ...body,
        scope:
          "배포된 endpoint·Bearer 인증만 검사합니다. 실제 scheduler 실행과 예약 게시 성공은 별도 확인합니다.",
      };
    }
    return {
      ...result(
        service,
        "connect",
        "PASS",
        "실제 서비스 응답을 확인했습니다.",
        { api_called: called, ...details },
      ),
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      ...failure(service, "connect", error, { api_called: called }),
      latency_ms: Date.now() - start,
    };
  }
}
