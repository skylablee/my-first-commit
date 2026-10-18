import { afterEach, expect, test, vi } from "vitest";
import { getSupabaseConfig } from "../src/lib/supabase/config";
import { checkOrigin, parseBody } from "../src/lib/server/api";
import { z } from "zod";
afterEach(() => vi.unstubAllEnvs());
test("missing/invalid public config is safe, ANON key supported", () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  expect(getSupabaseConfig()).toBeNull();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "javascript:alert(1)");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public");
  expect(getSupabaseConfig()).toBeNull();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  expect(getSupabaseConfig()?.key).toBe("public");
});
test("mutations reject foreign and absent origin", () => {
  expect(() =>
    checkOrigin(
      new Request("https://app.test/api/brands", {
        headers: { origin: "https://evil.test" },
      }),
    ),
  ).toThrow("허용되지");
  expect(() =>
    checkOrigin(new Request("https://app.test/api/brands")),
  ).toThrow();
  expect(() =>
    checkOrigin(
      new Request("https://app.test/api/brands", {
        headers: { origin: "https://app.test" },
      }),
    ),
  ).not.toThrow();
});
test("bounded JSON rejects huge inputs and schema violations", async () => {
  const request = (body: string) =>
    new Request("https://app.test/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  await expect(
    parseBody(
      request(JSON.stringify({ name: "가".repeat(60000) })),
      z.object({ name: z.string() }),
    ),
  ).rejects.toThrow("너무");
  await expect(
    parseBody(request("{bad"), z.object({ name: z.string() })),
  ).rejects.toThrow("형식");
});

test("Origin check accepts real Host behind Next internal bind hostname but still rejects cross-site calls", () => {
  const request = new Request("http://0.0.0.0:3000/api/brands", {
    headers: {
      host: "127.0.0.1:3000",
      origin: "http://127.0.0.1:3000",
      "x-forwarded-proto": "http",
    },
  });
  expect(() => checkOrigin(request)).not.toThrow();
  const httpsRequest = new Request("http://internal:3000/api/brands", {
    headers: {
      host: "app.example.test",
      origin: "https://app.example.test",
      "x-forwarded-proto": "https",
    },
  });
  expect(() => checkOrigin(httpsRequest)).not.toThrow();
  const badRequest = new Request("http://internal:3000/api/brands", {
    headers: {
      host: "app.example.test",
      origin: "https://evil.test",
      "x-forwarded-proto": "https",
    },
  });
  expect(() => checkOrigin(badRequest)).toThrow();
});
