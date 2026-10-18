import { route } from "@/lib/server/api";
import { cronAuth, rateLimit } from "@/lib/operations/guards";
import { runPublications } from "@/lib/threads/worker";
export const maxDuration = 90;
export async function GET(request: Request) {
  return route(async () => {
    cronAuth(request);
    await rateLimit(request, "cron");
    if(new URL(request.url).searchParams.get("probe")==="1")return {probe:true,deployment_reachable:true,scheduler_invoked:false};
    return { outcomes: await runPublications(undefined,undefined,"cron") };
  }, "scheduler");
}
