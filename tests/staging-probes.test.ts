import { beforeEach, afterEach, expect, test, vi } from "vitest";
const f = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({
  adminClient: () => ({ rpc: f.rpc, from: f.from }),
}));
import { smallAI } from "../src/lib/staging/ai-test";
import { serviceConfiguration } from "../src/lib/staging/config";
import { requireTestPayment, stagingEnabled } from "../src/lib/staging/safety";
beforeEach(() => {
  vi.clearAllMocks();
  f.from.mockImplementation(() => {
    const q = {
      update: () => q,
      eq: () => q,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ error: null }).then(resolve),
    };
    return q;
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("missing AI key yields NOT CONFIGURED without a DB reservation or API request", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const result = await smallAI("subject", "openai");
  expect(result.status).toBe("NOT CONFIGURED");
  expect(fetcher).not.toHaveBeenCalled();
  expect(f.rpc).not.toHaveBeenCalled();
});
test("three real-call paths followed by quota denial make only three outbound requests", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  let count = 0;
  f.rpc.mockImplementation(async () =>
    ++count <= 3
      ? { data: "usage-id", error: null }
      : { data: null, error: { code: "P0001", message: "QUOTA_EXCEEDED" } },
  );
  const fetcher = vi
    .fn()
    .mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 1 },
          }),
        ),
    );
  vi.stubGlobal("fetch", fetcher);
  for (let i = 0; i < 3; i++)
    expect((await smallAI("subject", "openai")).status).toBe("PASS");
  const fourth = await smallAI("subject", "openai");
  expect(fourth.status).toBe("FAIL");
  expect(fourth.error_category).toBe("QUOTA_EXCEEDED");
  expect(fourth.details.api_called).toBe(false);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
test("probe output contains only metadata and no prompt/body/key", async () => {
  vi.stubEnv("OPENAI_API_KEY", "private-provider-key");
  f.rpc.mockResolvedValue({ data: "id", error: null });
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 1 },
          }),
        ),
      ),
  );
  const output = await smallAI("subject", "openai");
  expect(output.details).toMatchObject({
    provider: "openai",
    model: "gpt-4o-mini",
    token_usage: { input_tokens: 10, output_tokens: 1 },
  });
  expect(JSON.stringify(output)).not.toContain("private-provider-key");
  expect(JSON.stringify(output)).not.toContain("Connection check.");
});
test("production tests remain disabled even with opt-in flag; live billing key is always rejected", () => {
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("APP_ENV", "development");
  vi.stubEnv("STAGING_VALIDATION_ENABLED", "true");
  expect(stagingEnabled()).toBe(false);
  vi.stubEnv("PAYMENT_PROVIDER", "stripe");
  vi.stubEnv("PAYMENT_SECRET_KEY", "sk_live_private");
  expect(() => requireTestPayment()).toThrow("test key");
});
test("configuration names and booleans do not expose values", () => {
  const data = serviceConfiguration({ OPENAI_API_KEY: "sensitive" });
  expect(data.find((c) => c.name === "OpenAI")?.missing).toHaveLength(0);
  expect(JSON.stringify(data)).not.toContain("sensitive");
});
