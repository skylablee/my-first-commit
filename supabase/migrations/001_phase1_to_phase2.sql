-- Only for databases where the original PHASE 1 schema was applied. Back up first.
-- Run once, then apply ../schema.sql. Existing records and IDs are retained.
begin;
alter table public.brands rename column owner_id to user_id;
alter table public.brands rename column name to brand_name;
alter table public.brands rename column audience to target_customer;
alter table public.brands rename column voice to tone;
alter table public.brands add column website text not null default '', add column blog_url text not null default '', add column instagram text not null default '', add column threads text not null default '', add column keywords text[] not null default '{}', add column forbidden_words text[] not null default '{}', add column updated_at timestamptz not null default now();
alter table public.contents rename column owner_id to user_id;
alter table public.contents rename column channel to platform;
alter table public.contents drop constraint if exists contents_channel_check;
alter table public.contents add constraint contents_platform_check check(platform in ('instagram','naver_blog','kakao','threads','carousel','shorts','hooks','hashtags'));
alter table public.contents add column source_type text not null default 'manual' check(source_type in ('manual','news','repurpose')), add column source_url text, add column published_at timestamptz, add column updated_at timestamptz not null default now();
alter table public.contents drop constraint if exists contents_body_check;
alter table public.contents add constraint contents_body_check check(char_length(body)<=20000);
commit;
