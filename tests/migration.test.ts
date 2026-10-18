import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
test("PHASE 1 migration preserves brand/content records and enables the new schema", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table public.brands(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),name text not null,industry text not null default '',audience text not null default '',voice text not null default '',description text not null default '',created_at timestamptz not null default now(),unique(id,owner_id));
 create table public.contents(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),brand_id uuid not null,title text not null,body text not null default '',channel text not null check(channel in ('instagram','naver_blog','kakao')),status text not null default 'draft',scheduled_at timestamptz,created_at timestamptz not null default now(),foreign key(brand_id,owner_id) references public.brands(id,owner_id));
 insert into auth.users values('11111111-1111-4111-8111-111111111111','a@example.test','{}');
 insert into public.brands(id,owner_id,name) values('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','기존 카페');
 insert into public.contents(owner_id,brand_id,title,body,channel) values('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','기존 초안','보존할 본문','instagram');`);
    await db.exec(
      readFileSync("supabase/migrations/001_phase1_to_phase2.sql", "utf8"),
    );
    await db.exec(readFileSync("supabase/schema.sql", "utf8"));
    expect(
      (await db.query("select brand_name from public.brands")).rows,
    ).toEqual([{ brand_name: "기존 카페" }]);
    expect(
      (await db.query("select body,platform,source_type from public.contents"))
        .rows,
    ).toEqual([
      { body: "보존할 본문", platform: "instagram", source_type: "manual" },
    ]);
  } finally {
    await db.close();
  }
}, 30000);
