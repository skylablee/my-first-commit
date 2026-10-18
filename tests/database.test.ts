import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111",
  bob = "22222222-2222-4222-8222-222222222222";
let brandId = "";
beforeAll(async () => {
  await db.exec(
    `create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema public,auth to anon,authenticated,service_role; grant execute on function auth.uid() to authenticated;`,
  );
  await db.exec(readFileSync("supabase/schema.sql", "utf8"));
  await db.exec(
    `insert into auth.users values('${alice}','alice@example.test','{"name":"Alice"}'),('${bob}','bob@example.test','{}');`,
  );
}, 30000);
afterAll(async () => {
  await db.close();
});
async function asUser(id: string, sql: string) {
  await db.exec(
    `set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`,
  );
  try {
    return await db.query(sql);
  } finally {
    await db.exec("reset role;");
  }
}
test("signup trigger creates a private profile; brands are isolated across users", async () => {
  const profile = await asUser(alice, "select name from public.profiles");
  expect(profile.rows).toEqual([{ name: "Alice" }]);
  const inserted = await asUser(
    alice,
    `insert into public.brands(user_id,brand_name) values('${alice}','카페') returning id`,
  );
  brandId = (inserted.rows[0] as { id: string }).id;
  expect((await asUser(bob, "select * from public.brands")).rows).toHaveLength(
    0,
  );
  expect(
    (
      await asUser(
        bob,
        `update public.brands set brand_name='침범' where id='${brandId}' returning id`,
      )
    ).rows,
  ).toHaveLength(0);
  await expect(
    asUser(
      bob,
      `insert into public.brands(user_id,brand_name) values('${alice}','위조')`,
    ),
  ).rejects.toThrow();
});
test("cross-owner content FK prevents attaching data to another brand", async () => {
  await expect(
    asUser(
      bob,
      `insert into public.contents(user_id,brand_id,title,body,platform) values('${bob}','${brandId}','도용','본문','instagram')`,
    ),
  ).rejects.toThrow();
  const result = await asUser(
    alice,
    `insert into public.contents(user_id,brand_id,title,body,platform) values('${alice}','${brandId}','제목','본문','instagram') returning id`,
  );
  expect(result.rows).toHaveLength(1);
  expect(
    (await asUser(bob, "select * from public.contents")).rows,
  ).toHaveLength(0);
});
test("users cannot edit usage or invoke service quota RPC; reservation cannot be bypassed by fast retries", async () => {
  await expect(
    asUser(
      alice,
      `select public.reserve_ai_usage('${alice}','openai','gpt-4o-mini')`,
    ),
  ).rejects.toThrow();
  await db.exec("set role service_role;");
  try {
    expect(
      (
        await db.query(
          `select public.reserve_ai_usage('${alice}','openai','gpt-4o-mini')`,
        )
      ).rows,
    ).toHaveLength(1);
    await expect(
      db.query(
        `select public.reserve_ai_usage('${alice}','openai','gpt-4o-mini')`,
      ),
    ).rejects.toThrow("RATE_LIMIT");
  } finally {
    await db.exec("reset role;");
  }
  await expect(
    asUser(alice, `update public.ai_usage set estimated_cost=0`),
  ).rejects.toThrow();
  expect(
    (await asUser(bob, "select * from public.ai_usage")).rows,
  ).toHaveLength(0);
});

test("daily per-user quota, global quota and persistent news rate limits reject excess requests", async () => {
  await db.exec(
    `truncate public.ai_usage; insert into public.ai_usage(user_id,provider,model,status,estimated_cost,created_at) select '${alice}','openai','gpt-4o-mini','completed',0.001,now()-interval '1 minute' from generate_series(1,20);`,
  );
  await db.exec("set role service_role;");
  try {
    await expect(
      db.query(
        `select public.reserve_ai_usage('${alice}','openai','gpt-4o-mini')`,
      ),
    ).rejects.toThrow("QUOTA_EXCEEDED");
  } finally {
    await db.exec("reset role;");
  }
  await db.exec(
    `truncate public.ai_usage; insert into public.ai_usage(user_id,provider,model,status,estimated_cost,created_at) select '${bob}','gemini','gemini-2.5-flash','completed',0.001,now()-interval '1 minute' from generate_series(1,500);`,
  );
  await db.exec("set role service_role;");
  try {
    await expect(
      db.query(
        `select public.reserve_ai_usage('${alice}','openai','gpt-4o-mini')`,
      ),
    ).rejects.toThrow("QUOTA_EXCEEDED");
    for (let i = 0; i < 20; i++)
      expect(
        (
          await db.query<{ ok: boolean }>(
            `select public.consume_api_request('${alice}','news') as ok`,
          )
        ).rows[0].ok,
      ).toBe(true);
    expect(
      (
        await db.query<{ ok: boolean }>(
          `select public.consume_api_request('${alice}','news') as ok`,
        )
      ).rows[0].ok,
    ).toBe(false);
  } finally {
    await db.exec("reset role;");
  }
});
test("usage totals are SQL aggregates restricted to authenticated user and schema is repeatable", async () => {
  await db.exec(
    `truncate public.ai_usage; insert into public.ai_usage(user_id,provider,model,status,input_tokens,output_tokens,estimated_cost) values('${alice}','openai','gpt-4o-mini','completed',100,50,0.001),('${bob}','gemini','gemini-2.5-flash','completed',900,800,0.002);`,
  );
  const result = await asUser(alice, "select public.usage_summary() as usage");
  expect((result.rows[0] as { usage: unknown }).usage).toMatchObject({
    today: 1,
    month: 1,
    input_tokens: 100,
    output_tokens: 50,
    estimated_cost: 0.001,
  });
  await db.exec(readFileSync("supabase/schema.sql", "utf8"));
  expect((await db.query("select id from public.contents")).rows).toHaveLength(
    1,
  );
});
