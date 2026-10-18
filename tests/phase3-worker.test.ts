import { beforeEach, afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), plan: vi.fn() }));
vi.mock("@/lib/server/admin", () => ({ adminClient: mocks.db }));
vi.mock("@/lib/operations/guards", () => ({
  effectivePlan: mocks.plan,
  guardBrand: vi.fn().mockResolvedValue(undefined),
}));
import { runPublications } from "../src/lib/threads/worker";
import {
  ThreadsError,
  type ThreadsProvider,
} from "../src/lib/threads/provider";
import { encrypt } from "../src/lib/operations/crypto";
let rows: Record<string, unknown>[];
let updates: Record<string, unknown>[];
let calls: string[];
let provider: ThreadsProvider;
let rpc: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv("TOKEN_ENCRYPTION_KEY", "22".repeat(32));
  rows = [
    {
      id: "job",
      user_id: "alice",
      content_id: "content",
      body_snapshot: "게시 본문",
      scheduled_at: null,
      provider_container_id: null,
      lock_token: "lock",
      retry_count: 0,
    },
  ];
  updates = [];
  calls = [];
  mocks.plan.mockResolvedValue("PRO");
  rpc = vi.fn(async (name: string) =>
    name === "claim_publications"
      ? { data: rows.splice(0), error: null }
      : { data: true, error: null },
  );
  mocks.db.mockReturnValue({
    rpc,
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        update: (row: Record<string, unknown>) => {
          updates.push(row);
          calls.push("db-update");
          return q;
        },
        single: async () => ({
          data: {
            brand_id: "brand",
            provider_user_id: "42",
            access_token_encrypted: encrypt("private", "threads:alice"),
            expires_at: "2099-01-01",
          },
          error: null,
        }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: null, error: null }).then(resolve),
      };
      return q;
    },
  });
  provider = {
    exchangeCode: vi.fn(),
    profile: vi.fn(),
    createContainer: vi.fn().mockResolvedValue("100"),
    containerStatus: vi.fn().mockResolvedValue("FINISHED"),
    publishContainer: vi.fn(async () => {
      calls.push("publish");
      return "200";
    }),
  };
});
afterEach(() => vi.unstubAllEnvs());
test("one claim publishes once, stores post ID and next claim cannot duplicate", async () => {
  expect((await runPublications(undefined, provider))[0].status).toBe(
    "published",
  );
  expect(await runPublications(undefined, provider)).toEqual([]);
  expect(provider.publishContainer).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith("finish_publication", {
    p_id: "job",
    p_lock_token: "lock",
    p_post_id: "200",
  });
  expect(updates).toContainEqual({ uncertain: true });
  expect(calls.indexOf("publish")).toBeGreaterThan(
    calls.lastIndexOf("db-update"),
  );
});
test("ambiguous failure quarantines instead of automatic retry", async () => {
  provider.publishContainer = vi
    .fn()
    .mockRejectedValue(new ThreadsError("UNKNOWN", "결과 불명", false, true));
  expect((await runPublications(undefined, provider))[0].status).toBe(
    "uncertain",
  );
  expect(updates.at(-1)).toMatchObject({
    status: "failed",
    uncertain: true,
    retry_count: 0,
  });
});
test("transient preparation error backs off and stops after three retries", async () => {
  provider.createContainer = vi
    .fn()
    .mockRejectedValue(new ThreadsError("RATE", "일시 오류", true));
  expect((await runPublications(undefined, provider))[0].status).toBe(
    "retrying",
  );
  expect(updates.at(-1)).toMatchObject({ status: "pending", retry_count: 1 });
  rows = [
    {
      id: "job",
      user_id: "alice",
      body_snapshot: "본문",
      lock_token: "lock",
      retry_count: 3,
    },
  ];
  expect((await runPublications(undefined, provider))[0].status).toBe("failed");
  expect(provider.publishContainer).not.toHaveBeenCalled();
});
test("expired paid plan blocks scheduled publishing at execution time", async () => {
  rows[0].scheduled_at = "2026-01-01";
  mocks.plan.mockResolvedValue("FREE");
  expect((await runPublications(undefined, provider))[0].status).toBe("failed");
  expect(provider.createContainer).not.toHaveBeenCalled();
});
