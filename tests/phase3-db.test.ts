import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, test } from "vitest";
const db = new PGlite();
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  await db.exec(
    `create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,service_role;grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(readFileSync("supabase/schema.sql", "utf8"));
  await db.exec(
    readFileSync("supabase/migrations/002_phase3_operations.sql", "utf8"),
  );
  await db.exec("update public.operating_settings set allow_mock_billing=true");
  await db.exec(
    `insert into auth.users values('${a}','a@test.local','{}'),('${b}','b@test.local','{}');`,
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
async function user(id: string, sql: string) {
  await db.exec(
    `set role authenticated;select set_config('request.jwt.claim.sub','${id}',false)`,
  );
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role");
  }
}
test("FREE brands cannot exceed one or insert another owner; PRO allows three and downgrade never deletes data", async () => {
  await user(
    a,
    `insert into public.brands(user_id,brand_name)values('${a}','첫 브랜드')`,
  );
  await expect(
    user(
      a,
      `insert into public.brands(user_id,brand_name)values('${a}','우회')`,
    ),
  ).rejects.toThrow("BRAND_LIMIT");
  await db.exec(
    `insert into public.subscriptions(user_id,plan_id,provider,status,current_period_end)values('${a}','PRO','mock','active',now()+interval '1 month')`,
  );
  await user(
    a,
    `insert into public.brands(user_id,brand_name)values('${a}','두번째'),('${a}','세번째')`,
  );
  await expect(
    user(
      a,
      `insert into public.brands(user_id,brand_name)values('${a}','네번째')`,
    ),
  ).rejects.toThrow("BRAND_LIMIT");
  await db.exec(
    `update public.subscriptions set plan_id='FREE' where user_id='${a}'`,
  );
  expect((await user(a, "select * from public.brands")).rows).toHaveLength(3);
});
test("monthly counter is atomic, quota prevents reservations and cannot be edited by clients", async () => {
  await db.exec(
    `insert into public.usage_counters values('${a}',date_trunc('month',now() at time zone 'Asia/Seoul')::date,10)`,
  );
  await db.exec("set role service_role");
  try {
    await expect(
      db.query(`select public.reserve_ai_usage('${a}','openai','gpt-4o-mini')`),
    ).rejects.toThrow("QUOTA_EXCEEDED");
  } finally {
    await db.exec("reset role");
  }
  await expect(
    user(a, "update public.usage_counters set ai_generations=0"),
  ).rejects.toThrow();
  await expect(
    user(a, `update public.subscriptions set plan_id='AGENCY'`),
  ).rejects.toThrow();
  await expect(
    user(a, `insert into public.user_roles values('${a}','admin')`),
  ).rejects.toThrow();
});
test("OAuth state is one-time, expiring and bound to user", async () => {
  await db.exec(
    `insert into public.oauth_states values('state','${a}',now()+interval '10 minutes',now())`,
  );
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.consume_oauth_state('state','${b}') as ok`,
      )
    ).rows[0].ok,
  ).toBe(false);
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.consume_oauth_state('state','${a}') as ok`,
      )
    ).rows[0].ok,
  ).toBe(true);
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.consume_oauth_state('state','${a}') as ok`,
      )
    ).rows[0].ok,
  ).toBe(false);
});
test("billing webhook dedup, stale events, cancel at period end and RLS", async () => {
  const apply = (
    id: string,
    plan: string,
    status: string,
    time: string,
    cancel = false,
  ) =>
    db.query<{ ok: boolean }>(
      `select public.apply_billing_event('mock','${id}','subscription.updated','${a}','${plan}','sub_a','${status}',now()+interval '1 month',${cancel},'${time}',59000)as ok`,
    );
  expect((await apply("e1", "PRO", "active", "2026-10-18")).rows[0].ok).toBe(
    true,
  );
  expect((await apply("e1", "PRO", "active", "2026-10-18")).rows[0].ok).toBe(
    false,
  );
  expect(
    (await apply("old", "STARTER", "active", "2026-10-17")).rows[0].ok,
  ).toBe(false);
  await apply("cancel", "PRO", "active", "2026-10-19", true);
  expect(
    (
      await db.query<{ plan: string }>(
        `select public.effective_plan('${a}')as plan`,
      )
    ).rows[0].plan,
  ).toBe("PRO");
  expect(
    (await user(b, "select * from public.billing_events")).rows,
  ).toHaveLength(0);
  await db.exec(
    `update public.subscriptions set current_period_end=now()-interval '1 second'`,
  );
  expect(
    (
      await db.query<{ plan: string }>(
        `select public.effective_plan('${a}')as plan`,
      )
    ).rows[0].plan,
  ).toBe("FREE");
});
test("scheduler plan guard, duplicate publication and lease locking prevent double publication", async () => {
  const brand = (
    await db.query<{ id: string }>(
      `select id from public.brands where user_id='${a}'limit 1`,
    )
  ).rows[0].id;
  const c = (
    await db.query<{ id: string }>(
      `insert into public.contents(user_id,brand_id,title,body,platform)values('${a}','${brand}','제목','Threads 게시 본문','threads')returning id`,
    )
  ).rows[0].id;
  await expect(
    db.query(
      `select public.enqueue_publication('${a}','${c}',now()+interval '1 day')`,
    ),
  ).rejects.toThrow("PLAN_REQUIRED");
  const job = (
    await db.query<{ id: string }>(
      `select public.enqueue_publication('${a}','${c}')as id`,
    )
  ).rows[0].id;
  await expect(
    db.query(`select public.enqueue_publication('${a}','${c}')`),
  ).rejects.toThrow();
  const claimed = await db.query<{ id: string; lock_token: string }>(
    `select * from public.claim_publications('${job}')`,
  );
  expect(claimed.rows).toHaveLength(1);
  expect(
    (await db.query(`select * from public.claim_publications('${job}')`)).rows,
  ).toHaveLength(0);
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.finish_publication('${job}','${claimed.rows[0].lock_token}','post_123')as ok`,
      )
    ).rows[0].ok,
  ).toBe(true);
  expect(
    (
      await db.query<{ status: string }>(
        `select status from public.contents where id='${c}'`,
      )
    ).rows[0].status,
  ).toBe("published");
});
test("persistent rate limit and encrypted columns remain protected", async () => {
  const call = () =>
    db.query<{ ok: boolean }>(
      `select public.consume_rate_limits(array['userhash','iphash'],'threads',2)as ok`,
    );
  expect((await call()).rows[0].ok).toBe(true);
  expect((await call()).rows[0].ok).toBe(true);
  expect((await call()).rows[0].ok).toBe(false);
  await expect(
    user(a, "select access_token_encrypted from public.social_connections"),
  ).rejects.toThrow();
  await expect(user(a, "select * from public.oauth_states")).rejects.toThrow();
});

test("future schedules are not claimed; uncertain expired lease cannot be retried; max manual retries is three", async () => {
  await db.exec(
    `update public.subscriptions set plan_id='PRO',status='active',current_period_end=now()+interval '1 month'where user_id='${a}'`,
  );
  const brand = (
    await db.query<{ id: string }>(
      `select id from public.brands where user_id='${a}'order by created_at,id limit 1`,
    )
  ).rows[0].id;
  const c = (
    await db.query<{ id: string }>(
      `insert into public.contents(user_id,brand_id,title,body,platform)values('${a}','${brand}','예약','본문','threads')returning id`,
    )
  ).rows[0].id;
  const job = (
    await db.query<{ id: string }>(
      `select public.enqueue_publication('${a}','${c}',now()+interval '1 day')as id`,
    )
  ).rows[0].id;
  expect(
    (await db.query(`select*from public.claim_publications('${job}')`)).rows,
  ).toHaveLength(0);
  await expect(
    user(a, `delete from public.contents where id='${c}'`),
  ).rejects.toThrow("PUBLICATION_PENDING");
  await db.exec(
    `update public.publications set status='publishing',locked_until=now()-interval '1 second'where id='${job}'`,
  );
  await db.query(`select*from public.claim_publications('${job}')`);
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.retry_publication('${a}','${job}')as ok`,
      )
    ).rows[0].ok,
  ).toBe(false);
  await db.exec(
    `update public.publications set status='failed',uncertain=false,retry_count=3 where id='${job}'`,
  );
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.retry_publication('${a}','${job}')as ok`,
      )
    ).rows[0].ok,
  ).toBe(false);
});
test("downgrade archives excess brands without deleting their records", async () => {
  await db.exec(
    `update public.subscriptions set plan_id='FREE'where user_id='${a}'`,
  );
  const ids = await db.query<{ id: string }>(
    `select id from public.brands where user_id='${a}'order by created_at,id`,
  );
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.is_active_brand('${a}','${ids.rows[0].id}')as ok`,
      )
    ).rows[0].ok,
  ).toBe(true);
  expect(
    (
      await db.query<{ ok: boolean }>(
        `select public.is_active_brand('${a}','${ids.rows[2].id}')as ok`,
      )
    ).rows[0].ok,
  ).toBe(false);
  await expect(
    user(
      a,
      `update public.brands set brand_name='초과 브랜드'where id='${ids.rows[2].id}'`,
    ),
  ).rejects.toThrow("BRAND_ARCHIVED");
  expect((await user(a, "select id from public.brands")).rows).toHaveLength(3);
});
test("mock entitlements need explicit sandbox activation; role and price tables cannot be edited", async () => {
  await db.exec(
    `update public.subscriptions set plan_id='PRO',current_period_end=now()+interval '1 month'where user_id='${a}';update public.operating_settings set allow_mock_billing=false;`,
  );
  expect(
    (
      await db.query<{ plan: string }>(
        `select public.effective_plan('${a}')as plan`,
      )
    ).rows[0].plan,
  ).toBe("FREE");
  await expect(
    user(a, "update public.plans set ai_limit=999999"),
  ).rejects.toThrow();
  await expect(
    user(a, "update public.operating_settings set allow_mock_billing=true"),
  ).rejects.toThrow();
  await db.exec("update public.operating_settings set allow_mock_billing=true");
});
test("migration reapplication preserves data, counters and jobs", async () => {
  const before = (await db.query("select id from public.publications")).rows;
  await db.exec(
    readFileSync("supabase/migrations/002_phase3_operations.sql", "utf8"),
  );
  expect((await db.query("select id from public.publications")).rows).toEqual(
    before,
  );
});
