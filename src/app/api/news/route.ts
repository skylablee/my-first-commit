import { rateLimit } from "@/lib/operations/guards";
import { z } from "zod";
import { route, enforceRate, recordError } from "@/lib/server/api";
import { requireUser } from "@/lib/server/auth";
import { searchGoogleNews, searchNaver } from "@/lib/providers/news";
const params = z.object({
  q: z.string().trim().min(1).max(100),
  provider: z.enum(["google", "naver"]),
  sort: z.enum(["date", "sim"]).default("date"),
});
export async function GET(request: Request) {
  return route(async () => {
    const { user } = await requireUser();
    const input = params.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    await rateLimit(request, "news", user.id);
    await enforceRate(user.id, "news");
    try {
      return {
        items:
          input.provider === "naver"
            ? await searchNaver(input.q, input.sort)
            : await searchGoogleNews(input.q),
      };
    } catch (error) {
      await recordError(user.id, input.provider, "/api/news", error);
      throw error;
    }
  }, "news");
}
