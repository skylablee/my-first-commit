import { afterEach, expect, test, vi } from "vitest";
import {
  OpenAIProvider,
  GeminiProvider,
  costUSD,
} from "../src/lib/ai/provider";
import { generatedSchema, bundleSchema } from "../src/lib/contracts";
const input = {
  system: "system",
  prompt: "prompt",
  maxOutputTokens: 3500,
  schema: { type: "object" },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("OpenAI structured output includes bounded output and accounts usage", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "제목",
                body: "본문",
                hashtags: ["#카페"],
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const result = await new OpenAIProvider().generateJSON(input);
  expect(generatedSchema.parse(result.value).title).toBe("제목");
  expect(result.inputTokens).toBe(100);
  const body = JSON.parse(fetcher.mock.calls[0][1].body);
  expect(body.max_completion_tokens).toBe(3500);
  expect(body.response_format.json_schema.strict).toBe(true);
  expect(JSON.stringify(result)).not.toContain("secret");
});
test("Gemini uses header authentication, schema and disables thinking budget", async () => {
  vi.stubEnv("GEMINI_API_KEY", "secret");
  const f = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [{ text: '{"title":"제목","body":"본문","hashtags":[]}' }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 10 },
      }),
    ),
  );
  vi.stubGlobal("fetch", f);
  expect(
    generatedSchema.parse(
      (await new GeminiProvider().generateJSON(input)).value,
    ).body,
  ).toBe("본문");
  expect(f.mock.calls[0][0]).not.toContain("secret");
  expect(
    JSON.parse(f.mock.calls[0][1].body).generationConfig.thinkingConfig
      .thinkingBudget,
  ).toBe(0);
});
test.each([
  [401, "OpenAI API 키"],
  [429, "요청 한도"],
  [500, "응답에 실패"],
])("OpenAI status %s maps to Korean safe errors", async (status, message) => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  const f = vi.fn().mockResolvedValue(new Response("{}", { status }));
  vi.stubGlobal("fetch", f);
  await expect(new OpenAIProvider().generateJSON(input)).rejects.toThrow(
    message,
  );
  expect(f).toHaveBeenCalledTimes(1);
});
test("quota error and invalid/truncated output never look like valid generated JSON", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('{"error":{"code":"insufficient_quota"}}', { status: 429 }),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"title":"partial"}' },
              finish_reason: "length",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 3500 },
        }),
      ),
    );
  vi.stubGlobal("fetch", f);
  await expect(new OpenAIProvider().generateJSON(input)).rejects.toThrow(
    "사용 한도",
  );
  expect((await new OpenAIProvider().generateJSON(input)).value).toBeNull();
});
test("cost estimates and repurpose cardinalities are validated", () => {
  expect(costUSD("openai", 1_000_000, 1_000_000)).toBe(0.75);
  expect(costUSD("gemini", 1_000_000, 1_000_000)).toBe(2.8);
  expect(bundleSchema.safeParse({ threads: ["한개"] }).success).toBe(false);
});

test("invalid model is distinct from authentication and rate limits and provider bodies remain private", async () => {
  vi.stubEnv("OPENAI_API_KEY", "secret");
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "model_not_found",
              message: "private upstream account information",
            },
          }),
          { status: 404 },
        ),
      ),
  );
  await expect(new OpenAIProvider().generateText(input)).rejects.toMatchObject({
    code: "PROVIDER_MODEL",
  });
});
