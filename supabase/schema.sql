-- PHASE 2 fresh installation. For an existing PHASE 1 schema, run
-- migrations/001_phase1_to_phase2.sql BEFORE this file. Never drop existing data.
begin;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 email text not null default '', name text not null default '' check(char_length(name)<=80),
 created_at timestamptz not null default now()
);
create table if not exists public.brands (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 brand_name text not null check(char_length(brand_name) between 1 and 150),
 industry text not null default '' check(char_length(industry)<=150),
 description text not null default '' check(char_length(description)<=1000),
 target_customer text not null default '' check(char_length(target_customer)<=150),
 tone text not null default '' check(char_length(tone)<=150),
 website text not null default '', blog_url text not null default '', instagram text not null default '', threads text not null default '',
 keywords text[] not null default '{}', forbidden_words text[] not null default '{}',
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(id,user_id)
);
create table if not exists public.products (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 brand_id uuid not null, product_name text not null check(char_length(product_name) between 1 and 150),
 product_description text not null default '', product_url text not null default '', price numeric(14,2) check(price>=0),
 features text[] not null default '{}', target_customer text not null default '', created_at timestamptz not null default now(),
 foreign key(brand_id,user_id) references public.brands(id,user_id) on delete cascade
);
create table if not exists public.contents (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 brand_id uuid not null, title text not null check(char_length(title) between 1 and 300),
 body text not null check(char_length(body)<=20000), platform text not null check(platform in ('instagram','naver_blog','kakao','threads','carousel','shorts','hooks','hashtags')),
 status text not null default 'draft' check(status in ('draft','scheduled','published')),
 source_type text not null default 'manual' check(source_type in ('manual','news','repurpose')),
 source_url text, scheduled_at timestamptz, published_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(brand_id,user_id) references public.brands(id,user_id) on delete cascade
);
create table if not exists public.ai_usage (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check(provider in ('openai','gemini')), model text not null,
 input_tokens integer not null default 0 check(input_tokens>=0), output_tokens integer not null default 0 check(output_tokens>=0),
 estimated_cost numeric(12,6) not null default 0.10 check(estimated_cost>=0),
 status text not null default 'pending' check(status in ('pending','completed','failed')),
 created_at timestamptz not null default now()
);
create table if not exists public.api_errors (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 service text not null, endpoint text not null, error_code text not null, message text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.api_requests (
 id bigint generated always as identity primary key, user_id uuid not null references auth.users(id) on delete cascade,
 service text not null, created_at timestamptz not null default now()
);
create index if not exists brands_user_idx on public.brands(user_id);
create index if not exists products_brand_idx on public.products(brand_id,user_id);
create index if not exists contents_user_created_idx on public.contents(user_id,created_at desc);
create index if not exists contents_brand_schedule_idx on public.contents(brand_id,scheduled_at);
create index if not exists ai_usage_user_created_idx on public.ai_usage(user_id,created_at);
create index if not exists ai_usage_created_idx on public.ai_usage(created_at);
create index if not exists api_errors_user_created_idx on public.api_errors(user_id,created_at);
create index if not exists api_requests_user_created_idx on public.api_requests(user_id,service,created_at);
create index if not exists api_requests_created_idx on public.api_requests(created_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now();return new;end; $$;
drop trigger if exists brands_updated on public.brands;
create trigger brands_updated before update on public.brands for each row execute function public.touch_updated_at();
drop trigger if exists contents_updated on public.contents;
create trigger contents_updated before update on public.contents for each row execute function public.touch_updated_at();
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id,email,name) values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'name',''),80)) on conflict(id) do nothing;return new;end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into public.profiles(id,email,name) select id,coalesce(email,''),left(coalesce(raw_user_meta_data->>'name',''),80) from auth.users on conflict(id) do nothing;

alter table public.profiles enable row level security;
alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.contents enable row level security;
alter table public.ai_usage enable row level security;
alter table public.api_errors enable row level security;
alter table public.api_requests enable row level security;
-- Remove legacy broad policy names as well as replacing named PHASE 2 policies.
drop policy if exists "Owners manage brands" on public.brands;
drop policy if exists "Owners manage contents" on public.contents;
drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles for all to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
drop policy if exists own_brand on public.brands;
create policy own_brand on public.brands for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists own_product on public.products;
create policy own_product on public.products for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists own_content on public.contents;
create policy own_content on public.contents for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
drop policy if exists read_own_usage on public.ai_usage;
create policy read_own_usage on public.ai_usage for select to authenticated using((select auth.uid())=user_id);
drop policy if exists read_own_errors on public.api_errors;
create policy read_own_errors on public.api_errors for select to authenticated using((select auth.uid())=user_id);
revoke all on public.profiles, public.brands, public.products, public.contents, public.ai_usage, public.api_errors, public.api_requests from anon, authenticated;
grant select,insert,update,delete on public.profiles,public.brands,public.products,public.contents to authenticated;
grant select on public.ai_usage,public.api_errors to authenticated;
grant all on public.profiles,public.brands,public.products,public.contents,public.ai_usage,public.api_errors,public.api_requests to service_role;
grant usage,select on sequence public.api_requests_id_seq to service_role;

-- Atomic, persistent quotas shared across all Vercel instances. Reservations are
-- pessimistic ($0.10). Uncertain failures retain their reservation; no free retry.
create or replace function public.reserve_ai_usage(p_user_id uuid,p_provider text,p_model text) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_day timestamptz := date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'; v_month timestamptz := date_trunc('month',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
 if p_provider not in ('openai','gemini') then raise exception 'INVALID_PROVIDER';end if;
 perform pg_advisory_xact_lock(7310241);
 if exists(select 1 from public.ai_usage where user_id=p_user_id and created_at>now()-interval '10 seconds') then raise exception 'RATE_LIMIT';end if;
 if (select count(*) from public.ai_usage where user_id=p_user_id and created_at>=v_day)>=20 or
    (select count(*) from public.ai_usage where user_id=p_user_id and created_at>=v_month)>=200 or
    (select coalesce(sum(estimated_cost),0) from public.ai_usage where user_id=p_user_id and created_at>=v_day)+0.10>1 or
    (select count(*) from public.ai_usage where created_at>=v_day)>=500 or
    (select coalesce(sum(estimated_cost),0) from public.ai_usage where created_at>=v_day)+0.10>25 then raise exception 'QUOTA_EXCEEDED';end if;
 insert into public.ai_usage(user_id,provider,model) values(p_user_id,p_provider,p_model) returning id into v_id;return v_id;
end; $$;
create or replace function public.consume_api_request(p_user_id uuid,p_service text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(7310242);
 if (select count(*) from public.api_requests where user_id=p_user_id and service=p_service and created_at>now()-interval '1 minute')>=20 or
 (select count(*) from public.api_requests where user_id=p_user_id and created_at>now()-interval '1 day')>=300 or
 (select count(*) from public.api_requests where created_at>now()-interval '1 day')>=10000 then return false;end if;
 insert into public.api_requests(user_id,service) values(p_user_id,p_service);return true;
end; $$;
revoke all on function public.reserve_ai_usage(uuid,text,text) from public,anon,authenticated;
revoke all on function public.consume_api_request(uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_ai_usage(uuid,text,text),public.consume_api_request(uuid,text) to service_role;
revoke all on function public.handle_new_user(),public.touch_updated_at() from public,anon,authenticated;
create or replace function public.usage_summary() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
 'today',count(*) filter(where created_at >= date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),
 'month',count(*),
 'estimated_cost',coalesce(sum(estimated_cost),0),
 'reserved',count(*) filter(where status in ('pending','failed')),
 'input_tokens',coalesce(sum(input_tokens),0),
 'output_tokens',coalesce(sum(output_tokens),0))
 from public.ai_usage where user_id=(select auth.uid()) and created_at >= date_trunc('month',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;
revoke all on function public.usage_summary() from public,anon;
grant execute on function public.usage_summary() to authenticated;
commit;
