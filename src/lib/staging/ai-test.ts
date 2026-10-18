import "server-only";
import { adminClient } from "../server/admin";
import { OpenAIProvider, GeminiProvider, costUSD } from "../ai/provider";
import { AppError } from "../server/errors";
import { dbError } from "../server/api";
import { result, failure } from "./results";
import type { CheckResult } from "./types";
export async function smallAI(
  userId: string,
  providerName: "openai" | "gemini",
  testName = "connect",
): Promise<CheckResult> {
  const label = providerName === "openai" ? "OpenAI" : "Gemini";
  if (
    !process.env[
      providerName === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"
    ]
  )
    return result(
      label,
      testName,
      "NOT CONFIGURED",
      "API 키가 설정되지 않아 호출하지 않았습니다.",
      { api_called: false },
    );
  const db = adminClient(),
    p = providerName === "openai" ? new OpenAIProvider() : new GeminiProvider();
  let called = false,
    reservationId: string | undefined;
  const started = Date.now();
  try {
    const reserve = await db.rpc("reserve_ai_usage", {
      p_user_id: userId,
      p_provider: providerName,
      p_model: p.model,
    });
    if (reserve.error) {
      if (/QUOTA_EXCEEDED/.test(reserve.error.message))
        throw new AppError(
          "QUOTA_EXCEEDED",
          "월 생성 한도로 차단했습니다. 외부 AI API를 호출하지 않았습니다.",
          429,
        );
      if (/RATE_LIMIT/.test(reserve.error.message))
        throw new AppError(
          "RATE_LIMIT",
          "10초 요청 간격 제한입니다. 외부 AI API를 호출하지 않았습니다.",
          429,
        );
      dbError(reserve.error);
    }
    if (!reserve.data)
      throw new AppError(
        "DATABASE_ERROR",
        "사용량 예약을 확인하지 못했습니다.",
        503,
      );
    reservationId = reserve.data;
    called = true;
    const generated = await p.generateText({
      system: "Reply exactly OK. Do not include anything else.",
      prompt: "Connection check.",
      maxOutputTokens: 16,
    });
    const stored = await db
      .from("ai_usage")
      .update({
        input_tokens: generated.inputTokens,
        output_tokens: generated.outputTokens,
        estimated_cost: costUSD(
          providerName,
          generated.inputTokens,
          generated.outputTokens,
        ),
        status: "completed",
      })
      .eq("id", reservationId)
      .eq("user_id", userId);
    dbError(stored.error);
    if (generated.text.trim() !== "OK")
      throw new AppError(
        "AI_TEST_OUTPUT",
        "최소 요청의 기대 응답이 아니었습니다. 사용량은 기록했습니다.",
        502,
      );
    return {
      ...result(
        label,
        testName,
        "PASS",
        "실제 AI 생성 응답과 사용량 기록을 확인했습니다.",
        {
          api_called: true,
          usage_id: reservationId,
          provider: providerName,
          model: p.model,
          ...(providerName === "openai"
            ? {
                token_usage: {
                  input_tokens: generated.inputTokens,
                  output_tokens: generated.outputTokens,
                },
              }
            : {}),
        },
      ),
      latency_ms: Date.now() - started,
    };
  } catch (error) {
    if (reservationId)
      await db
        .from("ai_usage")
        .update({ status: "failed" })
        .eq("id", reservationId)
        .eq("status", "pending");
    return {
      ...failure(label, testName, error, {
        api_called: called,
        provider: providerName,
        model: p.model,
      }),
      latency_ms: Date.now() - started,
    };
  }
}
