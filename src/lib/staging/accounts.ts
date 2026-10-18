import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "../supabase/config";
import { adminClient } from "../server/admin";
import { dbError } from "../server/api";
import { AppError } from "../server/errors";
import { result, failure } from "./results";
type Credentials = {
  email_a: string;
  password_a: string;
  email_b: string;
  password_b: string;
};
function anonymousClient() {
  const config = getSupabaseConfig();
  if (!config)
    throw new AppError("CONFIG_MISSING", "Supabase 공개 설정이 없습니다.", 503);
  return createClient(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) =>
        fetch(input, { ...init, signal: AbortSignal.timeout(10000) }),
    },
  });
}
async function account(
  adminId: string,
  label: "A" | "B",
  email: string,
  password: string,
  checks: Record<string, string>,
) {
  const db = adminClient(),
    client = anonymousClient();
  const existing = await db
    .from("staging_accounts")
    .select("user_id")
    .eq("admin_id", adminId)
    .eq("label", label)
    .maybeSingle();
  dbError(existing.error);
  let id: string | undefined = existing.data?.user_id;
  if (!id) {
    // Public signup may update an existing unconfirmed user. Refuse reuse first.
    let checkedAll = false;
    for (let page = 1; page <= 10; page++) {
      const listed = await db.auth.admin.listUsers({ page, perPage: 1000 });
      if (listed.error)
        throw new AppError(
          "TEST_ACCOUNT",
          "기존 계정 보호를 위한 사용자 확인에 실패했습니다.",
          503,
        );
      if (
        listed.data.users.some(
          (user) => user.email?.toLowerCase() === email.toLowerCase(),
        )
      )
        throw new AppError(
          "TEST_ACCOUNT",
          "이미 등록된 이메일입니다. 신규 전용 테스트 이메일을 사용하세요.",
          409,
        );
      if (listed.data.users.length < 1000) {
        checkedAll = true;
        break;
      }
    }
    if (!checkedAll)
      throw new AppError(
        "TEST_ACCOUNT",
        "사용자 목록 확인 범위를 초과했습니다. 별도 staging 프로젝트를 사용하세요.",
        409,
      );
    const signed = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: `BizContent staging ${label}`,
          staging_fixture_owner: adminId,
        },
        emailRedirectTo: `${process.env.APP_URL}/login`,
      },
    });
    if (
      signed.error ||
      !signed.data.user ||
      signed.data.user.identities?.length === 0
    )
      throw new AppError(
        "AUTH_SIGNUP_TEST",
        "전용 테스트 이메일의 회원가입이 실패했습니다. 기존 일반 계정은 사용하지 마세요. SMTP·CAPTCHA·가입 제한을 확인해 주세요.",
        409,
      );
    id = signed.data.user.id;
    if (id === adminId)
      throw new AppError(
        "TEST_ACCOUNT",
        "관리자 본인 계정은 테스트 fixture로 등록할 수 없습니다.",
        409,
      );
    const saved = await db
      .from("staging_accounts")
      .insert({ admin_id: adminId, user_id: id, label });
    dbError(saved.error);
    checks[`signup_${label}`] = "PASS";
  } else checks[`signup_${label}`] = "이전 전용 계정 재사용 — 이번 가입 미실행";
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error || login.data.user?.id !== id)
    throw new AppError(
      "AUTH_LOGIN_TEST",
      "전용 테스트 계정 로그인에 실패했습니다. 인증 메일 확인·비밀번호·이메일을 확인한 후 다시 실행하세요.",
      401,
    );
  checks[`login_${label}`] = "PASS";
  return { client, id };
}
async function resource(
  adminId: string,
  userId: string,
  kind: string,
  id: string,
) {
  const { error } = await adminClient()
    .from("staging_resources")
    .insert({ admin_id: adminId, user_id: userId, kind, resource_id: id });
  dbError(error);
}
async function insertBrand(
  client: SupabaseClient,
  userId: string,
  name: string,
) {
  const q = await client
    .from("brands")
    .insert({
      user_id: userId,
      brand_name: name,
      industry: "테스트",
      description: "BizContent AI staging validation",
      target_customer: "테스트 고객",
      tone: "간결한",
    })
    .select("id")
    .single();
  dbError(q.error);
  return q.data!.id as string;
}
export async function accountScenario(adminId: string, input: Credentials) {
  const checks: Record<string, string> = {};
  try {
    const a = await account(
        adminId,
        "A",
        input.email_a,
        input.password_a,
        checks,
      ),
      b = await account(adminId, "B", input.email_b, input.password_b, checks);
    if (a.id === b.id)
      throw new AppError(
        "TEST_ACCOUNT",
        "서로 다른 두 테스트 계정이 필요합니다.",
      );
    // Only remove our own tagged fixture brands. Never reset user data or counters.
    for (const who of [a, b]) {
      const old = await adminClient()
        .from("staging_resources")
        .select("resource_id")
        .eq("admin_id", adminId)
        .eq("user_id", who.id)
        .eq("kind", "account_brand");
      dbError(old.error);
      for (const row of old.data ?? []) {
        const deleted = await who.client
          .from("brands")
          .delete()
          .eq("id", row.resource_id)
          .eq("user_id", who.id);
        dbError(deleted.error);
      }
    }
    const aid = await insertBrand(a.client, a.id, "staging Brand create"),
      bid = await insertBrand(b.client, b.id, "staging RLS B");
    await resource(adminId, a.id, "account_brand", aid);
    await resource(adminId, b.id, "account_brand", bid);
    checks.brand_create = "PASS";
    const updated = await a.client
      .from("brands")
      .update({ brand_name: "staging Brand updated" })
      .eq("id", aid)
      .select("brand_name")
      .single();
    dbError(updated.error);
    if (updated.data?.brand_name !== "staging Brand updated")
      throw new AppError(
        "CRUD_TEST",
        "브랜드 수정 내용을 확인하지 못했습니다.",
      );
    checks.brand_update = "PASS";
    const content = await a.client
      .from("contents")
      .insert({
        user_id: a.id,
        brand_id: aid,
        title: "staging content persistence",
        body: "BizContent AI staging connection test",
        platform: "threads",
        status: "draft",
      })
      .select("id")
      .single();
    dbError(content.error);
    checks.content_save = "PASS";
    for (const [table, id] of [
      ["profiles", b.id],
      ["brands", bid],
    ] as const) {
      const foreign = await a.client.from(table).select("id").eq("id", id);
      dbError(foreign.error);
      if (foreign.data?.length)
        throw new AppError(
          "RLS_CRITICAL",
          "다른 사용자의 행이 조회되어 테스트를 중단했습니다.",
          409,
        );
    }
    const attack = await b.client
      .from("brands")
      .update({ brand_name: "RLS should block" })
      .eq("id", aid)
      .select("id");
    if (attack.data?.length)
      throw new AppError(
        "RLS_CRITICAL",
        "다른 사용자의 수정이 허용되었습니다.",
        409,
      );
    const foreignContent = await b.client
      .from("contents")
      .select("id")
      .eq("id", content.data!.id);
    dbError(foreignContent.error);
    if (foreignContent.data?.length)
      throw new AppError(
        "RLS_CRITICAL",
        "다른 사용자의 콘텐츠가 조회되었습니다.",
        409,
      );
    checks.rls_read_write = "PASS";
    const removed = await a.client
      .from("brands")
      .delete()
      .eq("id", aid)
      .select("id");
    dbError(removed.error);
    if (removed.data?.length !== 1)
      throw new AppError("CRUD_TEST", "브랜드 삭제를 확인하지 못했습니다.");
    checks.brand_delete = "PASS";
    const keptBrand = await insertBrand(
      a.client,
      a.id,
      "staging persistence fixture",
    );
    await resource(adminId, a.id, "account_brand", keptBrand);
    const kept = await a.client
      .from("contents")
      .insert({
        user_id: a.id,
        brand_id: keptBrand,
        title: "staging relogin persistence",
        body: "BizContent AI staging connection test",
        platform: "threads",
        status: "draft",
      })
      .select("id")
      .single();
    dbError(kept.error);
    await resource(adminId, a.id, "account_content", kept.data!.id);
    const out = await a.client.auth.signOut();
    if (out.error)
      throw new AppError(
        "AUTH_LOGOUT_TEST",
        "테스트 계정 로그아웃에 실패했습니다.",
      );
    const relogin = await a.client.auth.signInWithPassword({
      email: input.email_a,
      password: input.password_a,
    });
    if (relogin.error)
      throw new AppError(
        "AUTH_LOGIN_TEST",
        "테스트 계정 재로그인에 실패했습니다.",
      );
    const persisted = await a.client
      .from("contents")
      .select("id")
      .eq("id", kept.data!.id)
      .single();
    dbError(persisted.error);
    checks.logout_relogin_persistence = "PASS";
    await a.client.auth.signOut();
    await b.client.auth.signOut();
    return result(
      "Supabase",
      "accounts_crud_rls",
      "PASS",
      "실제 Auth·DB CRUD·두 사용자 RLS·재로그인 후 데이터 유지를 확인했습니다.",
      {
        api_called: true,
        checks,
        test_user_id: a.id,
        scope:
          "SMTP 메일 수신은 자동 검증하지 않습니다. 기존 등록 계정 재사용 시 이번 회원가입 성공으로 간주하지 않습니다.",
      },
    );
  } catch (error) {
    return failure("Supabase", "accounts_crud_rls", error, {
      api_called: true,
      checks,
    });
  }
}
