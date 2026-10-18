import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/server/auth";
import { adminClient } from "@/lib/server/admin";
import { dbError } from "@/lib/server/api";
import { rateLimit } from "@/lib/operations/guards";
import { digest, encrypt, secureEqual } from "@/lib/operations/crypto";
import { MetaThreadsProvider } from "@/lib/threads/provider";
import { requestOrigin } from "@/lib/server/origin";
import { AppError } from "@/lib/server/errors";
import { audit } from "@/lib/operations/audit";
import { logError } from "@/lib/operations/logger";
export async function GET(request: Request) {
  const store = await cookies();
  const origin = process.env.APP_URL || requestOrigin(request);
  try {
    const { user } = await requireUser();
    await rateLimit(request, "oauth", user.id);
    const url = new URL(request.url),
      state = url.searchParams.get("state"),
      saved = store.get("threads_oauth_state")?.value;
    store.set("threads_oauth_state", "", {
      path: "/api/threads/callback",
      maxAge: 0,
    });
    if (!state || state.length > 128 || !saved || !secureEqual(state, saved))
      throw new AppError("OAUTH_STATE", "OAuth 상태 검증에 실패했습니다.", 400);
    const db = adminClient();
    const consumed = await db.rpc("consume_oauth_state", {
      p_hash: digest(state),
      p_user_id: user.id,
    });
    dbError(consumed.error);
    if (!consumed.data)
      throw new AppError(
        "OAUTH_REPLAY",
        "만료되었거나 이미 사용한 OAuth 요청입니다.",
        400,
      );
    const code = url.searchParams.get("code");
    if (url.searchParams.has("error") || !code || code.length > 2000)
      throw new AppError("OAUTH_DENIED", "Threads 연결이 취소되었습니다.", 400);
    const provider = new MetaThreadsProvider(),
      token = await provider.exchangeCode(code),
      profile = await provider.profile(token.accessToken);
    const savedConnection = await db.from("social_connections").upsert(
      {
        user_id: user.id,
        provider: "threads",
        provider_user_id: profile.id,
        username: profile.username,
        access_token_encrypted: encrypt(
          token.accessToken,
          `threads:${user.id}`,
        ),
        refresh_token_encrypted: null,
        expires_at: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
        scopes: ["threads_basic", "threads_content_publish"],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );
    dbError(savedConnection.error);
    await audit(user.id, "integration.connect", "threads", profile.id, {
      provider: "threads",
    });
    return NextResponse.redirect(
      new URL("/?threads=connected#integrations", origin),
    );
  } catch (error) {
    const id = logError(
      "threads",
      error instanceof AppError ? error.code : "OAUTH_FAILED",
    );
    return NextResponse.redirect(
      new URL(`/?threads=failed&request_id=${id}#integrations`, origin),
    );
  }
}
