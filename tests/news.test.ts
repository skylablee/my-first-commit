import { afterEach, expect, test, vi } from "vitest";
import {
  parseRSS,
  searchNaver,
  searchGoogleNews,
  safeLink,
} from "../src/lib/providers/news";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
test("RSS parser reads Korean titles and source, removes unsafe links and rejects entities", () => {
  const result = parseRSS(
    '<rss><channel><item><title><![CDATA[동네 <b>카페</b> 소식]]></title><link>https://news.example/a</link><source url="https://example.test">지역신문</source><pubDate>today</pubDate></item><item><title>bad</title><link>javascript:alert(1)</link></item></channel></rss>',
  );
  expect(result).toHaveLength(1);
  expect(result[0].title).toBe("동네 카페 소식");
  expect(result[0].source).toBe("지역신문");
  expect(() => parseRSS("<!DOCTYPE foo><rss/>")).toThrow();
  expect(safeLink("javascript:alert(1)")).toBe("");
});
test("Naver keyword and sort are encoded and credentials remain in server headers", async () => {
  vi.stubEnv("NAVER_CLIENT_ID", "test-id");
  vi.stubEnv("NAVER_CLIENT_SECRET", "test-secret");
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        items: [
          {
            title: "<b>카페</b>",
            description: "a &amp; b",
            link: "https://news.test/1",
            originallink: "https://publisher.test/1",
            pubDate: "today",
          },
        ],
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const results = await searchNaver("카페 & 빵", "sim");
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("query")).toBe(
    "카페 & 빵",
  );
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("sort")).toBe(
    "sim",
  );
  expect(results[0].title).toBe("카페");
  expect(JSON.stringify(results)).not.toContain("test-secret");
});
test("unconfigured Naver and unavailable RSS yield explicit errors", async () => {
  vi.stubEnv("NAVER_CLIENT_ID", "");
  await expect(searchNaver("카페", "date")).rejects.toThrow("설정");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("Forbidden", { status: 403 })),
  );
  await expect(searchGoogleNews("카페")).rejects.toThrow("Google News");
});
