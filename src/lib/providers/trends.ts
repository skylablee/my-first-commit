import { z } from "zod";
import { parseRSS } from "./news.ts";
import { boundedText, externalRequest } from "../server/http.ts";
import { AppError } from "../server/errors.ts";
export type Trend = {
  title: string;
  link: string;
  publishedAt?: string;
  value?: number;
};
export interface TrendProvider {
  getTrendingSearches(): Promise<Trend[]>;
  searchKeyword(keyword: string): Promise<Trend[]>;
  getRelatedQueries(keyword: string): Promise<Trend[]>;
}
const exploreSchema = z.object({
  widgets: z.array(
    z.object({
      id: z.string(),
      token: z.string(),
      request: z.record(z.string(), z.unknown()),
    }),
  ),
});
// Unofficial public Google Trends RSS/web endpoints. No scraping service or paid API.
// These endpoints can change or be blocked: the caller must render unavailable UI.
export class GoogleTrendsProvider implements TrendProvider {
  async getTrendingSearches() {
    const response = await externalRequest(
      "https://trends.google.com/trending/rss?geo=KR",
      {},
      1,
    );
    if (!response.ok)
      throw new AppError(
        "TRENDS_UNAVAILABLE",
        "Google Trends를 지금 불러올 수 없습니다. 뉴스 검색을 이용해 주세요.",
        502,
      );
    return parseRSS(await boundedText(response)).map((n) => ({
      title: n.title,
      link: n.link,
      publishedAt: n.publishedAt,
    }));
  }
  private async json(url: URL): Promise<unknown> {
    const r = await externalRequest(url.toString(), {}, 1);
    if (!r.ok)
      throw new AppError(
        "TRENDS_UNAVAILABLE",
        "Google Trends에서 요청을 제한했습니다. 잠시 후 다시 시도해 주세요.",
        502,
      );
    try {
      return JSON.parse((await boundedText(r)).replace(/^\)\]\}',?\s*/, ""));
    } catch {
      throw new AppError(
        "TRENDS_CHANGED",
        "Google Trends 응답 형식이 변경되었습니다.",
        502,
      );
    }
  }
  private async widget(keyword: string, id: string) {
    const url = new URL("https://trends.google.com/trends/api/explore");
    url.search = new URLSearchParams({
      hl: "ko",
      tz: "-540",
      req: JSON.stringify({
        comparisonItem: [{ keyword, geo: "KR", time: "today 3-m" }],
        category: 0,
        property: "",
      }),
    }).toString();
    const parsed = exploreSchema.safeParse(await this.json(url));
    if (!parsed.success)
      throw new AppError(
        "TRENDS_CHANGED",
        "Google Trends 응답을 읽지 못했습니다.",
        502,
      );
    const widget = parsed.data.widgets.find((w) => w.id === id);
    if (!widget)
      throw new AppError(
        "TRENDS_EMPTY",
        "검색어에 대한 Google Trends 데이터가 없습니다.",
        404,
      );
    return widget;
  }
  async searchKeyword(keyword: string) {
    const widget = await this.widget(keyword, "TIMESERIES");
    const url = new URL(
      "https://trends.google.com/trends/api/widgetdata/multiline",
    );
    url.search = new URLSearchParams({
      hl: "ko",
      tz: "-540",
      token: widget.token,
      req: JSON.stringify(widget.request),
    }).toString();
    const data = z
      .object({
        default: z.object({
          timelineData: z
            .array(
              z.object({
                formattedTime: z.string(),
                value: z.array(z.number()),
              }),
            )
            .max(400),
        }),
      })
      .safeParse(await this.json(url));
    if (!data.success)
      throw new AppError(
        "TRENDS_CHANGED",
        "검색 관심도 형식이 변경되었습니다.",
        502,
      );
    return data.data.default.timelineData.slice(-12).map((item) => ({
      title: `${keyword} · ${item.formattedTime}`,
      value: item.value[0] ?? 0,
      link: `https://trends.google.com/trends/explore?geo=KR&q=${encodeURIComponent(keyword)}`,
    }));
  }
  async getRelatedQueries(keyword: string) {
    const widget = await this.widget(keyword, "RELATED_QUERIES");
    const url = new URL(
      "https://trends.google.com/trends/api/widgetdata/relatedsearches",
    );
    url.search = new URLSearchParams({
      hl: "ko",
      tz: "-540",
      token: widget.token,
      req: JSON.stringify(widget.request),
    }).toString();
    const data = z
      .object({
        default: z.object({
          rankedList: z.array(
            z.object({
              rankedKeyword: z
                .array(z.object({ query: z.string(), value: z.number() }))
                .optional(),
            }),
          ),
        }),
      })
      .safeParse(await this.json(url));
    if (!data.success)
      throw new AppError(
        "TRENDS_CHANGED",
        "연관 검색어 형식이 변경되었습니다.",
        502,
      );
    return data.data.default.rankedList
      .flatMap((list) => list.rankedKeyword ?? [])
      .slice(0, 20)
      .map((item) => ({
        title: item.query,
        value: item.value,
        link: `https://trends.google.com/trends/explore?geo=KR&q=${encodeURIComponent(item.query)}`,
      }));
  }
}
