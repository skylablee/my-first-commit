import { afterEach, expect, test, vi } from "vitest";
import { boundedText, externalRequest } from "../src/lib/server/http";
afterEach(() => vi.unstubAllGlobals());
test("read-only transient calls retry once, paid POSTs never retry and have a timeout signal", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(new Response("bad", { status: 503 }))
    .mockResolvedValueOnce(new Response("ok"));
  vi.stubGlobal("fetch", f);
  expect((await externalRequest("https://news.google.com", {}, 1)).status).toBe(
    200,
  );
  expect(f).toHaveBeenCalledTimes(2);
  expect(f.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  f.mockReset().mockRejectedValue(new Error("private upstream detail"));
  await expect(
    externalRequest("https://api.openai.com", { method: "POST" }),
  ).rejects.toThrow("외부");
  expect(f).toHaveBeenCalledTimes(1);
});
test("large streaming response is rejected", async () => {
  await expect(boundedText(new Response("abc"), 2)).rejects.toThrow("너무");
});

test("paid request timeout is categorized separately without leaking transport details or retrying", async () => {
  const timeout = new Error("private transport details");
  timeout.name = "TimeoutError";
  const fetcher = vi.fn().mockRejectedValue(timeout);
  vi.stubGlobal("fetch", fetcher);
  await expect(
    externalRequest("https://api.openai.com", { method: "POST" }),
  ).rejects.toMatchObject({ code: "UPSTREAM_TIMEOUT", status: 504 });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
