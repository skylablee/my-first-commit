import { audit } from "@/lib/operations/audit";
import { rateLimit } from "@/lib/operations/guards";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { route, checkOrigin, parseBody } from "@/lib/server/api";
import { requestOrigin } from "@/lib/server/origin";
import { AppError } from "@/lib/server/errors";
const schema = z.object({
  action: z.enum(["login", "signup", "logout"]),
  email: z.email().max(254).optional(),
  password: z.string().min(8).max(128).optional(),
  name: z.string().trim().min(1).max(80).optional(),
});
export async function POST(request: Request) {
  return route(async () => {
    checkOrigin(request);
    const input = await parseBody(request, schema);
    const db = await createClient();
    if (!db)
      throw new AppError(
        "CONFIG_MISSING",
        "Supabase 환경변수를 설정해 주세요.",
        503,
      );
    await rateLimit(request, "auth");
    if (input.action === "logout") {
      const { error } = await db.auth.signOut();
      if (error)
        throw new AppError("AUTH_ERROR", "로그아웃에 실패했습니다.", 502);
      return { ok: true };
    }
    if (!input.email || !input.password)
      throw new AppError(
        "VALIDATION_ERROR",
        "이메일과 8자 이상의 비밀번호를 입력해 주세요.",
      );
    if (input.action === "signup") {
      const { data, error } = await db.auth.signUp({
        email: input.email,
        password: input.password,
        options: {
          data: { name: input.name ?? "" },
          emailRedirectTo: new URL(
            "/auth/callback",
            requestOrigin(request),
          ).toString(),
        },
      });
      if (error)
        throw new AppError(
          "AUTH_ERROR",
          error.status === 429
            ? "가입 요청이 많습니다. 잠시 후 다시 시도해 주세요."
            : "회원가입에 실패했습니다. 입력 내용과 이메일 인증 설정을 확인해 주세요.",
          400,
        );
      return {
        ok: true,
        confirmed: Boolean(data.session),
        message:
          "인증 메일을 확인해 주세요. 이미 가입된 이메일이라면 로그인해 주세요.",
      };
    }
    const { data: loginData, error } = await db.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error)
      throw new AppError(
        "AUTH_ERROR",
        error.status === 429
          ? "로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요."
          : "이메일·비밀번호 또는 이메일 인증 여부를 확인해 주세요.",
        401,
      );
    if (loginData.user) await audit(loginData.user.id, "login", "auth");
    return { ok: true };
  }, "auth");
}
