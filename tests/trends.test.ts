import { afterEach, expect, test, vi } from "vitest";
import { GoogleTrendsProvider } from "../src/lib/providers/trends";
afterEach(() => vi.unstubAllGlobals());
test("unofficial trend endpoints parse RSS, interest and related searches", async () => {
  const p = new GoogleTrendsProvider();
  const f = vi.fn();
  vi.stubGlobal("fetch", f);
  f.mockResolvedValueOnce(
    new Response(
      "<rss><channel><item><title>카페</title><link>https://trends.google.com/a</link></item></channel></rss>",
    ),
  );
  expect((await p.getTrendingSearches())[0].title).toBe("카페");
  f.mockResolvedValueOnce(
    new Response(
      `)]}',\n${JSON.stringify({ widgets: [{ id: "TIMESERIES", token: "token", request: {} }] })}`,
    ),
  ).mockResolvedValueOnce(
    new Response(
      `)]}',\n${JSON.stringify({ default: { timelineData: [{ formattedTime: "오늘", value: [78] }] } })}`,
    ),
  );
  expect((await p.searchKeyword("카페"))[0].value).toBe(78);
  f.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        widgets: [{ id: "RELATED_QUERIES", token: "t", request: {} }],
      }),
    ),
  ).mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        default: {
          rankedList: [{ rankedKeyword: [{ query: "동네 카페", value: 90 }] }],
        },
      }),
    ),
  );
  expect((await p.getRelatedQueries("카페"))[0].title).toBe("동네 카페");
});
test("blocked or changed trends are recoverable errors", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("blocked", { status: 403 })),
  );
  await expect(
    new GoogleTrendsProvider().getTrendingSearches(),
  ).rejects.toThrow("뉴스 검색");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  await expect(
    new GoogleTrendsProvider().searchKeyword("카페"),
  ).rejects.toThrow("응답");
});
