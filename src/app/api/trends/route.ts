import { rateLimit } from "@/lib/operations/guards";
import { z } from "zod";
import { route, enforceRate, recordError } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { GoogleTrendsProvider } from "@/lib/providers/trends";
export async function GET(request: Request) {
  return route(async () => {
    const { user } = await requireUser();
    const url = new URL(request.url);
    const action = z
      .enum(["trending", "search", "related"])
      .parse(url.searchParams.get("action") ?? "trending");
    const q =
      action === "trending"
        ? ""
        : z.string().trim().min(1).max(100).parse(url.searchParams.get("q"));
    await rateLimit(request, "news", user.id);
    await enforceRate(user.id, "trends");
    const provider = new GoogleTrendsProvider();
    try {
      return {
        unofficial: true,
        items:
          action === "trending"
            ? await provider.getTrendingSearches()
            : action === "search"
              ? await provider.searchKeyword(q)
              : await provider.getRelatedQueries(q),
      };
    } catch (error) {
      await recordError(user.id, "google_trends", "/api/trends", error);
      throw error;
    }
  }, "news");
}
