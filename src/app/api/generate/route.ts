import { rateLimit, guardFeature, guardBrand } from "@/lib/operations/guards";
import { z } from "zod";
import {
  generationInput,
  generatedSchema,
  bundleSchema,
} from "@/lib/contracts";
import { requireUser } from "@/lib/server/auth";
import {
  route,
  checkOrigin,
  parseBody,
  dbError,
  recordError,
} from "@/lib/server/api";
import { adminClient } from "@/lib/server/admin";
import { AppError } from "@/lib/server/errors";
import { toBrand } from "@/lib/server/mappers";
import { OpenAIProvider, GeminiProvider, costUSD } from "@/lib/ai/provider";
import { buildPrompt } from "@/lib/ai/prompt";
export const maxDuration = 90;
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { db, user } = await requireUser();
    const input = await parseBody(request, generationInput);
    await rateLimit(request, "ai", user.id);
    await guardBrand(user.id, input.brand_id);
    if (input.mode !== "single") await guardFeature(user.id, "repurpose");
    const key =
      input.provider === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.GEMINI_API_KEY;
    if (!key)
      throw new AppError(
        "CONFIG_MISSING",
        `${input.provider === "openai" ? "OPENAI_API_KEY" : "GEMINI_API_KEY"}를 설정해 주세요.`,
        503,
      );
    const { data: row, error } = await db
      .from("brands")
      .select("*")
      .eq("id", input.brand_id)
      .eq("user_id", user.id)
      .single();
    dbError(error);
    if (!row)
      throw new AppError("NOT_FOUND", "저장된 브랜드를 선택해 주세요.", 404);
    const brand = toBrand(row),
      prompt = buildPrompt(input, brand);
    if (prompt.prompt.length > 18000)
      throw new AppError(
        "INPUT_TOO_LONG",
        "브랜드 정보와 원문 길이를 줄여 주세요.",
      );
    const provider =
      input.provider === "openai" ? new OpenAIProvider() : new GeminiProvider();
    const admin = adminClient();
    // Reserve before calling a paid endpoint. The RPC is service-role-only and atomic.
    const reservation = await admin.rpc("reserve_ai_usage", {
      p_user_id: user.id,
      p_provider: input.provider,
      p_model: provider.model,
    });
    if (reservation.error) {
      const limit = /RATE_LIMIT|QUOTA_EXCEEDED|GLOBAL_BUDGET_EXCEEDED/.test(
        reservation.error.message,
      );
      throw new AppError(
        limit ? "QUOTA_EXCEEDED" : "DATABASE_ERROR",
        limit
          ? "플랜의 월 생성 한도·전체 예산 또는 10초 요청 간격 제한에 도달했습니다. Billing에서 확인해 주세요."
          : "사용량을 예약하지 못했습니다. DB 스키마를 확인해 주세요.",
        limit ? 429 : 503,
      );
    }
    if (!reservation.data)
      throw new AppError("DATABASE_ERROR", "사용량 예약에 실패했습니다.", 503);
    let accounted = false;
    try {
      const schema = input.mode === "all" ? bundleSchema : generatedSchema;
      const jsonSchema = z.toJSONSchema(schema);
      delete jsonSchema.$schema;
      const result = await provider.generateJSON({
        ...prompt,
        maxOutputTokens: input.mode === "all" ? 6500 : 3500,
        schema: jsonSchema,
      });
      // Persist billing information even if the generated JSON fails validation below.
      const cost = costUSD(
        input.provider,
        result.inputTokens,
        result.outputTokens,
      );
      const logged = await admin
        .from("ai_usage")
        .update({
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          estimated_cost: cost,
          status: "completed",
        })
        .eq("id", reservation.data)
        .eq("user_id", user.id);
      dbError(logged.error);
      accounted = true;
      const parsed = schema.safeParse(result.value);
      if (!parsed.success)
        throw new AppError(
          "AI_INVALID_OUTPUT",
          "AI 응답 형식이 올바르지 않거나 길이 제한에 도달했습니다. 입력을 줄여 다시 시도해 주세요. 사용량은 이미 기록되었습니다.",
          502,
        );
      const text = JSON.stringify(parsed.data).toLocaleLowerCase();
      if (
        brand.forbidden_words?.some(
          (word) => word.trim() && text.includes(word.toLocaleLowerCase()),
        )
      )
        throw new AppError(
          "FORBIDDEN_WORD",
          "생성 결과에 브랜드 금칙어가 있어 표시하지 않았습니다. 주제를 수정해 주세요.",
          422,
        );
      return {
        result: parsed.data,
        bundle: input.mode === "all",
        usage: {
          provider: input.provider,
          model: provider.model,
          input_tokens: result.inputTokens,
          output_tokens: result.outputTokens,
          estimated_cost: cost,
        },
      };
    } catch (error) {
      if (!accounted) {
        try {
          await admin
            .from("ai_usage")
            .update({ status: "failed" })
            .eq("id", reservation.data)
            .eq("user_id", user.id);
        } catch {
          /* Keep original safe error; the reservation remains pending. */
        }
      } // Pessimistic reservation retained: upstream may have billed.
      await recordError(user.id, input.provider, "/api/generate", error);
      throw error;
    }
  }, "AI");
}
