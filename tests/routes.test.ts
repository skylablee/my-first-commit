vi.mock("@/lib/operations/guards", () => ({
  rateLimit: vi.fn().mockResolvedValue(undefined),
  guardFeature: vi.fn().mockResolvedValue("PRO"),
  guardBrand: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/operations/audit", () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}));
import { beforeEach, expect, test, vi } from "vitest";
const f = vi.hoisted(() => ({
  requireUser: vi.fn(),
  admin: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("@/lib/server/auth", () => ({ requireUser: f.requireUser }));
vi.mock("@/lib/server/admin", () => ({ adminClient: f.admin }));
vi.mock("@/lib/ai/provider", async (original) => {
  const real = await original<typeof import("../src/lib/ai/provider")>();
  return {
    ...real,
    OpenAIProvider: class {
      model = "gpt-4o-mini";
      generateJSON = f.generate;
    },
  };
});
import {
  POST as saveBrand,
  DELETE as deleteBrand,
} from "../src/app/api/brands/route";
import { POST as saveContent } from "../src/app/api/contents/route";
import { POST as generate } from "../src/app/api/generate/route";
import { AppError } from "../src/lib/server/errors";
const userId = "11111111-1111-4111-8111-111111111111",
  brandId = "22222222-2222-4222-8222-222222222222";
const brand = {
  id: brandId,
  brand_name: "카페",
  industry: "카페",
  target_customer: "직장인",
  tone: "친근한",
  description: "동네 카페",
  keywords: [],
  forbidden_words: [],
  website: "",
  blog_url: "",
  instagram: "",
  threads: "",
};
function chain(result: unknown) {
  const q: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve(result).then(resolve),
  };
  for (const method of [
    "select",
    "eq",
    "insert",
    "update",
    "delete",
    "order",
    "limit",
  ])
    q[method] = vi.fn(() => q);
  q.single = vi.fn().mockResolvedValue(result);
  return q;
}
const request = (path: string, body: unknown) =>
  new Request(`https://app.test/api/${path}`, {
    method: "POST",
    headers: { origin: "https://app.test", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  f.requireUser.mockResolvedValue({
    db: { from: f.from },
    user: { id: userId },
  });
  f.admin.mockReturnValue({
    rpc: f.rpc,
    from: () => chain({ data: null, error: null }),
  });
  vi.stubEnv("OPENAI_API_KEY", "secret");
});
test("brand write binds user ID from session; rejects malformed data", async () => {
  const q = chain({ data: brand, error: null });
  f.from.mockReturnValue(q);
  const response = await saveBrand(
    request("brands", {
      name: "카페",
      industry: "카페",
      audience: "직장인",
      voice: "친근한",
      description: "소개",
      user_id: "attacker",
    }),
  );
  expect(response.status).toBe(200);
  expect(q.insert).toHaveBeenCalledWith(
    expect.objectContaining({ user_id: userId, brand_name: "카페" }),
  );
  expect((await saveBrand(request("brands", { name: "" }))).status).toBe(400);
});
test("content save checks brand ownership and forces draft state", async () => {
  const q = chain({
    data: {
      id: "33333333-3333-4333-8333-333333333333",
      brand_id: brandId,
      title: "제목",
      body: "본문",
      platform: "instagram",
      status: "draft",
      created_at: new Date().toISOString(),
    },
    error: null,
  });
  f.from.mockReturnValue(q);
  const response = await saveContent(
    request("contents", {
      brand_id: brandId,
      title: "제목",
      body: "본문",
      channel: "인스타그램",
      status: "published",
      user_id: "attacker",
    }),
  );
  expect(response.status).toBe(200);
  expect(q.eq).toHaveBeenCalledWith("user_id", userId);
  expect(q.insert).toHaveBeenCalledWith(
    expect.objectContaining({ status: "draft", user_id: userId }),
  );
});
test("unauthenticated direct API mutations fail and do not access DB", async () => {
  f.requireUser.mockRejectedValue(
    new AppError("UNAUTHORIZED", "로그인이 필요합니다.", 401),
  );
  expect((await saveBrand(request("brands", {}))).status).toBe(401);
  expect((await saveContent(request("contents", {}))).status).toBe(401);
  expect(f.from).not.toHaveBeenCalled();
});
test("foreign brand deletion cannot report success", async () => {
  f.from.mockReturnValue(chain({ data: [], error: null }));
  const r = await deleteBrand(
    new Request(`https://app.test/api/brands?id=${brandId}`, {
      method: "DELETE",
      headers: { origin: "https://app.test" },
    }),
  );
  expect(r.status).toBe(404);
});
const genInput = {
  provider: "openai",
  brand_id: brandId,
  topic: "신메뉴",
  platform: "인스타그램",
  tone: "친근한",
  length: "보통",
};
test("atomic quota denial prevents any paid provider call", async () => {
  f.from.mockReturnValue(chain({ data: brand, error: null }));
  f.rpc.mockResolvedValue({ data: null, error: { message: "QUOTA_EXCEEDED" } });
  const response = await generate(request("generate", genInput));
  expect(response.status).toBe(429);
  expect(f.generate).not.toHaveBeenCalled();
});
test("generation records usage before returning validated output", async () => {
  f.from.mockReturnValue(chain({ data: brand, error: null }));
  f.rpc.mockResolvedValue({ data: "usage-id", error: null });
  f.generate.mockResolvedValue({
    value: { title: "제목", body: "본문", hashtags: ["#카페"] },
    inputTokens: 100,
    outputTokens: 50,
    model: "gpt-4o-mini",
  });
  const response = await generate(request("generate", genInput));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.result.title).toBe("제목");
  expect(result.usage.input_tokens).toBe(100);
});
