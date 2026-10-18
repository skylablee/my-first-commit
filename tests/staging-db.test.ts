import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, test } from "vitest";
const db = new PGlite(),
  admin = "11111111-1111-4111-8111-111111111111",
  subject = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333";
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,service_role;grant execute on function auth.uid()to authenticated;`,
  );
  for (const path of [
    "supabase/schema.sql",
    "supabase/migrations/002_phase3_operations.sql",
    "supabase/migrations/003_phase35_staging_validation.sql",
  ])
    await db.exec(readFileSync(path, "utf8"));
  await db.exec(
    `insert into auth.users values('${admin}','admin@test.local','{}'),('${subject}','a@test.local','{}'),('${other}','b@test.local','{}');insert into public.user_roles values('${admin}','admin');insert into public.staging_accounts(user_id,admin_id,label)values('${subject}','${admin}','A');`,
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
test("schema version, RLS flags and protected token/counter grants are verifiable", async () => {
  const data = (
    await db.query<{
      report: {
        versions: string[];
        token_select_blocked: boolean;
        usage_write_blocked: boolean;
        quota_function_current: boolean;
        tables: { rls: boolean; policies: number }[];
      };
    }>("select public.staging_schema_status()as report")
  ).rows[0].report;
  expect(data.versions).toContain("003_phase35_staging_validation");
  expect(data.token_select_blocked).toBe(true);
  expect(data.usage_write_blocked).toBe(true);
  expect(data.quota_function_current).toBe(true);
  expect(data.tables.every((t) => t.rls && t.policies > 0)).toBe(true);
});
test("test override is opt-in, admin-scoped and cannot modify another user", async () => {
  await expect(
    db.query(
      `select public.staging_set_usage_limit('${admin}','${subject}',true)`,
    ),
  ).rejects.toThrow("STAGING_DISABLED");
  await db.exec(
    "update public.operating_settings set staging_validation_enabled=true",
  );
  await expect(
    db.query(
      `select public.staging_set_usage_limit('${other}','${subject}',true)`,
    ),
  ).rejects.toThrow("ADMIN_REQUIRED");
  await expect(
    db.query(
      `select public.staging_set_usage_limit('${admin}','${other}',true)`,
    ),
  ).rejects.toThrow("DEDICATED_FREE_ACCOUNT_REQUIRED");
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.staging_set_usage_limit('${admin}','${subject}',true)as ok`,
      )
    ).rows[0].ok,
  ).toBe(true);
});
test("3 reservations succeed, fourth quota blocks; restore and paid upgrade do not reset counters", async () => {
  for (let i = 0; i < 3; i++) {
    await db.query(
      `select public.reserve_ai_usage('${subject}','openai','gpt-4o-mini')`,
    );
    await db.exec(
      `update public.ai_usage set created_at=now()-interval '11 seconds'where user_id='${subject}'`,
    );
  }
  await expect(
    db.query(
      `select public.reserve_ai_usage('${subject}','openai','gpt-4o-mini')`,
    ),
  ).rejects.toThrow("QUOTA_EXCEEDED");
  await db.exec(
    `insert into public.subscriptions(user_id,plan_id,provider,status,current_period_end)values('${subject}','STARTER','stripe','active',now()+interval '1 month')`,
  );
  await expect(
    db.query(
      `select public.reserve_ai_usage('${subject}','openai','gpt-4o-mini')`,
    ),
  ).resolves.toBeDefined();
  await db.query(
    `select public.staging_set_usage_limit('${admin}','${subject}',false)`,
  );
  expect(
    (await db.query("select*from public.staging_usage_overrides")).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<{ n: number }>(
        `select ai_generations as n from public.usage_counters where user_id='${subject}'`,
      )
    ).rows[0].n,
  ).toBe(4);
});
test("expiry restores FREE limit automatically and test execution cannot be enabled by ordinary users", async () => {
  await db.exec(
    `delete from public.subscriptions where user_id='${subject}';insert into public.staging_usage_overrides values('${subject}','${admin}',3,now()-interval '1 minute');update public.ai_usage set created_at=now()-interval '11 seconds'where user_id='${subject}'`,
  );
  await expect(
    db.query(
      `select public.reserve_ai_usage('${subject}','openai','gpt-4o-mini')`,
    ),
  ).resolves.toBeDefined();
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${subject}',false)`,
  );
  try {
    await expect(
      db.query("select*from public.staging_checks"),
    ).rejects.toThrow();
    await expect(
      db.query(
        `select public.staging_set_usage_limit('${admin}','${subject}',true)`,
      ),
    ).rejects.toThrow();
  } finally {
    await db.exec("reset role");
  }
});
test("publication lifecycle is persisted and duplicate webhook receipts stay separate from entitlement events", async () => {
  await db.exec(
    `insert into public.brands(user_id,brand_name)values('${admin}','staging')`,
  );
  const b = (
    await db.query<{ id: string }>(
      `select id from public.brands where user_id='${admin}'`,
    )
  ).rows[0].id;
  const c = (
    await db.query<{ id: string }>(
      `insert into public.contents(user_id,brand_id,title,body,platform)values('${admin}','${b}','staging','BizContent AI staging connection test','threads')returning id`,
    )
  ).rows[0].id;
  const id = (
    await db.query<{ id: string }>(
      `select public.enqueue_publication('${admin}','${c}')as id`,
    )
  ).rows[0].id;
  const lock = (
    await db.query<{ lock_token: string }>(
      `select*from public.claim_publications('${id}')`,
    )
  ).rows[0].lock_token;
  await db.query(`select public.finish_publication('${id}','${lock}','123')`);
  expect(
    (
      await db.query<{ status: string }>(
        `select status from public.publication_transitions where publication_id='${id}'order by created_at,id`,
      )
    ).rows.map((r) => r.status),
  ).toEqual(["pending", "publishing", "published"]);
  await db.exec(
    `insert into public.billing_webhook_deliveries(provider,provider_event_id,request_id)values('stripe','evt_duplicate',gen_random_uuid()),('stripe','evt_duplicate',gen_random_uuid())`,
  );
  expect(
    (await db.query("select*from public.billing_webhook_deliveries")).rows,
  ).toHaveLength(2);
});
