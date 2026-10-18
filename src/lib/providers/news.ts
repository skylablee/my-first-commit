import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { externalRequest, externalJSON, boundedText } from "../server/http.ts";
import { AppError } from "../server/errors.ts";
export type NewsItem = {
  title: string;
  description: string;
  link: string;
  originallink: string;
  pubDate: string;
  source: string;
  publishedAt: string;
};
export function plainText(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(
      /&(?:amp|lt|gt|quot|apos|#39);/g,
      (s) =>
        ({
          "&amp;": "&",
          "&lt;": "<",
          "&gt;": ">",
          "&quot;": '"',
          "&apos;": "'",
          "&#39;": "'",
        })[s] ?? s,
    )
    .trim();
}
export function safeLink(value: unknown) {
  try {
    const u = new URL(String(value));
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.toString()
      : "";
  } catch {
    return "";
  }
}
const naverResponse = z.object({
  items: z
    .array(
      z.object({
        title: z.string(),
        description: z.string(),
        link: z.string(),
        originallink: z.string(),
        pubDate: z.string(),
      }),
    )
    .max(100),
});
export async function searchNaver(
  query: string,
  sort: "date" | "sim",
): Promise<NewsItem[]> {
  const id = process.env.NAVER_CLIENT_ID,
    secret = process.env.NAVER_CLIENT_SECRET;
  if (!id || !secret)
    throw new AppError(
      "CONFIG_MISSING",
      "NAVER_CLIENT_ID와 NAVER_CLIENT_SECRET을 설정해 주세요.",
      503,
    );
  const url = new URL("https://openapi.naver.com/v1/search/news.json");
  url.search = new URLSearchParams({ query, sort, display: "20" }).toString();
  const response = await externalRequest(
    url.toString(),
    { headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret } },
    1,
  );
  if (!response.ok)
    throw new AppError(
      "NAVER_ERROR",
      response.status === 401
        ? "네이버 API 인증 정보를 확인해 주세요."
        : response.status === 429
          ? "네이버 API 요청 한도를 확인해 주세요."
          : "네이버 뉴스 검색에 실패했습니다.",
      502,
    );
  const parsed = naverResponse.safeParse(await externalJSON(response));
  if (!parsed.success)
    throw new AppError(
      "INVALID_RESPONSE",
      "네이버 뉴스 응답 형식이 변경되었습니다.",
      502,
    );
  return parsed.data.items
    .map((item) => ({
      title: plainText(item.title),
      description: plainText(item.description),
      link: safeLink(item.link),
      originallink: safeLink(item.originallink),
      pubDate: item.pubDate,
      publishedAt: item.pubDate,
      source: "네이버 뉴스",
    }))
    .filter((i) => i.link);
}
export function parseRSS(xml: string): NewsItem[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new AppError("INVALID_RSS", "지원하지 않는 RSS 형식입니다.", 502);
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      processEntities: false,
      parseTagValue: false,
    });
    const root = parser.parse(xml);
    if (!root?.rss?.channel) throw new Error("missing channel");
    const raw = root.rss.channel.item;
    const items = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
    return items
      .slice(0, 30)
      .map((item: Record<string, unknown>) => {
        const source =
          typeof item.source === "object" && item.source
            ? String(
                (item.source as Record<string, unknown>)["#text"] ??
                  "Google News",
              )
            : String(item.source ?? "Google News");
        return {
          title: plainText(item.title),
          description: plainText(item.description).slice(0, 1000),
          link: safeLink(item.link),
          originallink: safeLink(item.link),
          pubDate: String(item.pubDate ?? ""),
          publishedAt: String(item.pubDate ?? ""),
          source: plainText(source),
        };
      })
      .filter((item: NewsItem) => item.link && item.title);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("INVALID_RSS", "뉴스 피드를 읽지 못했습니다.", 502);
  }
}
export async function searchGoogleNews(query: string): Promise<NewsItem[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.search = new URLSearchParams({
    q: query,
    hl: "ko",
    gl: "KR",
    ceid: "KR:ko",
  }).toString();
  const response = await externalRequest(url.toString(), {}, 1);
  if (!response.ok)
    throw new AppError(
      "GOOGLE_NEWS_ERROR",
      "Google News에 연결하지 못했습니다.",
      502,
    );
  return parseRSS(await boundedText(response));
}
