import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { requireUser } from "@/lib/server/auth";
import { adminClient } from "@/lib/server/admin";
import { route, checkOrigin, dbError } from "@/lib/server/api";
import { rateLimit } from "@/lib/operations/guards";
import { digest } from "@/lib/operations/crypto";
import { AppError } from "@/lib/server/errors";
import { requestOrigin } from "@/lib/server/origin";
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const { user } = await requireUser();
    await rateLimit(request, "oauth", user.id);
    const app = process.env.THREADS_APP_ID,
      redirect = process.env.THREADS_REDIRECT_URI;
    if (
      !app ||
      !redirect ||
      new URL(redirect).origin !==
        (process.env.APP_URL || requestOrigin(request))
    )
      throw new AppError(
        "CONFIG_MISSING",
        "Threads 앱 ID와 Redirect URI, APP_URL을 확인해 주세요.",
        503,
      );
    const state = randomBytes(32).toString("base64url");
    const { error } = await adminClient()
      .from("oauth_states")
      .insert({
        state_hash: digest(state),
        user_id: user.id,
        expires_at: new Date(Date.now() + 600000).toISOString(),
      });
    dbError(error);
    (await cookies()).set("threads_oauth_state", state, {
      httpOnly: true,
      secure: new URL(redirect).protocol === "https:",
      sameSite: "lax",
      path: "/api/threads/callback",
      maxAge: 600,
    });
    const url = new URL("https://www.threads.net/oauth/authorize");
    url.search = new URLSearchParams({
      client_id: app,
      redirect_uri: redirect,
      scope: "threads_basic,threads_content_publish",
      response_type: "code",
      state,
    }).toString();
    return { url: url.toString() };
  }, "threads");
}
