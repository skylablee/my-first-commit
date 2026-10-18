import { z } from "zod";
import { externalRequest, externalJSON } from "../server/http.ts";
import { AppError } from "../server/errors.ts";
export type AIRequest = {
  system: string;
  prompt: string;
  maxOutputTokens: number;
  schema?: Record<string, unknown>;
};
export type AIResult = {
  text: string;
  value: unknown;
  inputTokens: number;
  outputTokens: number;
  model: string;
};
export interface AIProvider {
  readonly model: string;
  generateText(input: AIRequest): Promise<AIResult>;
  generateJSON(input: AIRequest): Promise<AIResult>;
}
const usage = z.number().int().nonnegative().max(1_000_000);
function parsedJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
export async function providerFailure(
  response: Response,
  provider: "openai" | "gemini",
): Promise<never> {
  let quota = false;
  let invalidModel=false;
  try {
    const data = await externalJSON(response);
    const parsed = z
      .object({
        error: z.object({
          code: z.union([z.string(), z.number()]).optional(),
          type: z.string().optional(),
        }),
      })
      .safeParse(data);
    invalidModel=response.status===404||(parsed.success&&["model_not_found","invalid_model","NOT_FOUND"].includes(String(parsed.data.error.code)));
    quota =
      parsed.success &&
      (parsed.data.error.code === "insufficient_quota" ||
        parsed.data.error.type === "insufficient_quota");
  } catch {
    /* Upstream payloads are not exposed or logged. */
  }
  if(invalidModel)throw new AppError("PROVIDER_MODEL","AI 모델이 없거나 접근 권한이 없습니다.",502);
  if (provider === "openai" && quota)
    throw new AppError(
      "OPENAI_QUOTA",
      "OpenAI API 사용 한도를 확인해주세요.",
      429,
    );
  if (response.status === 401 || response.status === 403)
    throw new AppError(
      "PROVIDER_AUTH",
      provider === "openai"
        ? "OpenAI API 키를 확인해주세요."
        : "Gemini API 키와 접근 권한을 확인해주세요.",
      502,
    );
  if (response.status === 429)
    throw new AppError(
      "PROVIDER_RATE_LIMIT",
      "API 요청 한도 또는 크레딧을 확인해주세요.",
      429,
    );
  throw new AppError(
    "PROVIDER_ERROR",
    "AI 서비스 응답에 실패했습니다. 잠시 후 다시 시도해 주세요.",
    502,
  );
}
export class OpenAIProvider implements AIProvider {
  readonly model = "gpt-4o-mini";
  private async run(input: AIRequest, json: boolean): Promise<AIResult> {
    const key = process.env.OPENAI_API_KEY;
    if (!key)
      throw new AppError(
        "CONFIG_MISSING",
        "OPENAI_API_KEY를 설정해 주세요.",
        503,
      );
    const response = await externalRequest(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt },
          ],
          max_completion_tokens: input.maxOutputTokens,
          ...(json
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "marketing_content",
                    strict: true,
                    schema: input.schema,
                  },
                },
              }
            : {}),
        }),
      },
    );
    if (!response.ok) return providerFailure(response, "openai");
    const result = z
      .object({
        choices: z
          .array(
            z.object({
              message: z.object({ content: z.string().nullable() }),
              finish_reason: z.string(),
            }),
          )
          .min(1),
        usage: z.object({ prompt_tokens: usage, completion_tokens: usage }),
      })
      .safeParse(await externalJSON(response));
    if (!result.success)
      throw new AppError(
        "AI_INVALID_RESPONSE",
        "OpenAI 응답 형식을 확인할 수 없습니다.",
        502,
      );
    const first = result.data.choices[0],
      text = first.message.content ?? "";
    return {
      text,
      value: first.finish_reason === "stop" ? parsedJSON(text) : null,
      inputTokens: result.data.usage.prompt_tokens,
      outputTokens: result.data.usage.completion_tokens,
      model: this.model,
    };
  }
  generateText(input: AIRequest) {
    return this.run(input, false);
  }
  generateJSON(input: AIRequest) {
    return this.run(input, true);
  }
}
export class GeminiProvider implements AIProvider {
  readonly model = "gemini-2.5-flash";
  private async run(input: AIRequest, json: boolean): Promise<AIResult> {
    const key = process.env.GEMINI_API_KEY;
    if (!key)
      throw new AppError(
        "CONFIG_MISSING",
        "GEMINI_API_KEY를 설정해 주세요.",
        503,
      );
    const response = await externalRequest(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: {
            maxOutputTokens: input.maxOutputTokens,
            thinkingConfig: { thinkingBudget: 0 },
            ...(json
              ? {
                  responseMimeType: "application/json",
                  responseJsonSchema: input.schema,
                }
              : {}),
          },
        }),
      },
    );
    if (!response.ok) return providerFailure(response, "gemini");
    const result = z
      .object({
        candidates: z
          .array(
            z.object({
              content: z.object({
                parts: z.array(z.object({ text: z.string().optional() })),
              }),
              finishReason: z.string(),
            }),
          )
          .min(1),
        usageMetadata: z.object({
          promptTokenCount: usage,
          candidatesTokenCount: usage.optional(),
          thoughtsTokenCount: usage.optional(),
        }),
      })
      .safeParse(await externalJSON(response));
    if (!result.success)
      throw new AppError(
        "AI_INVALID_RESPONSE",
        "Gemini 응답 형식을 확인할 수 없습니다.",
        502,
      );
    const first = result.data.candidates[0],
      text = first.content.parts.map((p) => p.text ?? "").join("");
    return {
      text,
      value: first.finishReason === "STOP" ? parsedJSON(text) : null,
      inputTokens: result.data.usageMetadata.promptTokenCount,
      outputTokens:
        (result.data.usageMetadata.candidatesTokenCount ?? 0) +
        (result.data.usageMetadata.thoughtsTokenCount ?? 0),
      model: this.model,
    };
  }
  generateText(input: AIRequest) {
    return this.run(input, false);
  }
  generateJSON(input: AIRequest) {
    return this.run(input, true);
  }
}
export const MODEL_PRICING = {
  openai: { input: 0.15, output: 0.6 },
  gemini: { input: 0.3, output: 2.5 },
} as const;
// USD / 1M tokens. Estimates only; review provider pricing before production.
export function estimateCost(
  provider: keyof typeof MODEL_PRICING,
  input: number,
  output: number,
) {
  const rates = MODEL_PRICING[provider];
  return Math.round(
    input * rates.input + output * rates.output,
  ); /* micro-USD, converted below */
}
export function costUSD(
  provider: keyof typeof MODEL_PRICING,
  input: number,
  output: number,
) {
  return estimateCost(provider, input, output) / 1_000_000;
}
