-- Additive validation support; apply AFTER 002. Never enables tests automatically.
begin;
alter table public.operating_settings add column if not exists staging_validation_enabled boolean not null default false;
alter table public.api_errors add column if not exists error_category text;
create table if not exists public.schema_versions(version text primary key,applied_at timestamptz not null default now());
create table if not exists public.staging_checks(id uuid primary key default gen_random_uuid(),admin_id uuid not null references auth.users(id)on delete cascade,test_name text not null,service text not null,status text not null check(status in('PASS','FAIL','NOT CONFIGURED')),safe_message text not null,request_id uuid not null,latency_ms integer,error_category text,details jsonb not null default '{}',created_at timestamptz not null default now());
create index if not exists staging_checks_admin_created_idx on public.staging_checks(admin_id,created_at desc);
create table if not exists public.staging_accounts(user_id uuid primary key references auth.users(id)on delete cascade,admin_id uuid not null references auth.users(id)on delete cascade,label text not null check(label in('A','B')),created_at timestamptz not null default now(),unique(admin_id,label));
create table if not exists public.staging_resources(id uuid primary key default gen_random_uuid(),admin_id uuid not null references auth.users(id)on delete cascade,user_id uuid not null references auth.users(id)on delete cascade,kind text not null,resource_id uuid not null,created_at timestamptz not null default now(),unique(kind,resource_id));
create table if not exists public.staging_usage_overrides(user_id uuid primary key references auth.users(id)on delete cascade,admin_id uuid not null references auth.users(id)on delete cascade,ai_limit integer not null check(ai_limit=3),expires_at timestamptz not null);
create table if not exists public.billing_webhook_deliveries(id uuid primary key default gen_random_uuid(),provider text not null,provider_event_id text not null,request_id uuid not null,created_at timestamptz not null default now());
create index if not exists webhook_deliveries_event_idx on public.billing_webhook_deliveries(provider,provider_event_id,created_at);
alter table public.publications add column if not exists username text;
alter table public.publications add column if not exists last_executor text;
create table if not exists public.publication_transitions(id bigint generated always as identity primary key,publication_id uuid not null references public.publications(id)on delete cascade,status text not null,created_at timestamptz not null default now());
create or replace function public.track_publication_transition()returns trigger language plpgsql security definer set search_path=''as $$begin if tg_op='INSERT'or old.status is distinct from new.status then insert into public.publication_transitions(publication_id,status)values(new.id,new.status);end if;return new;end;$$;
drop trigger if exists publication_transition_log on public.publications;
create trigger publication_transition_log after insert or update on public.publications for each row execute function public.track_publication_transition();
revoke all on function public.track_publication_transition()from public,anon,authenticated;
create or replace function public.staging_set_usage_limit(p_admin_id uuid,p_user_id uuid,p_enable boolean)returns boolean language plpgsql security definer set search_path=''as $$
begin
 if not exists(select 1 from public.user_roles where user_id=p_admin_id and role='admin')then raise exception 'ADMIN_REQUIRED';end if;
 if not p_enable then delete from public.staging_usage_overrides where user_id=p_user_id and admin_id=p_admin_id;return true;end if;
 if not(select staging_validation_enabled from public.operating_settings where id)then raise exception 'STAGING_DISABLED';end if;
 if not exists(select 1 from public.staging_accounts where user_id=p_user_id and admin_id=p_admin_id)or public.effective_plan(p_user_id)<>'FREE'then raise exception 'DEDICATED_FREE_ACCOUNT_REQUIRED';end if;
 perform pg_advisory_xact_lock(7310241);
 if coalesce((select ai_generations from public.usage_counters where user_id=p_user_id and period_start=date_trunc('month',now()at time zone 'Asia/Seoul')::date),0)<>0 then raise exception 'FRESH_TEST_ACCOUNT_REQUIRED';end if;
 insert into public.staging_usage_overrides values(p_user_id,p_admin_id,3,now()+interval '20 minutes')on conflict(user_id)do update set expires_at=excluded.expires_at;
 return true;
end;$$;
-- Keep normal quota logic intact; scoped override only in an explicitly enabled test DB.
create or replace function public.reserve_ai_usage(p_user_id uuid,p_provider text,p_model text)returns uuid language plpgsql security definer set search_path=''as $$
declare v_id uuid;v_count integer;v_limit integer;v_override integer;v_month date:=date_trunc('month',now()at time zone 'Asia/Seoul')::date;v_day timestamptz:=date_trunc('day',now()at time zone 'Asia/Seoul')at time zone 'Asia/Seoul';
begin
 if p_provider not in('openai','gemini')then raise exception 'INVALID_PROVIDER';end if;
 perform pg_advisory_xact_lock(7310241);
 select ai_limit into v_limit from public.plans where id=public.effective_plan(p_user_id);
 if public.effective_plan(p_user_id)='FREE'and(select staging_validation_enabled from public.operating_settings where id)then
 select ai_limit into v_override from public.staging_usage_overrides where user_id=p_user_id and expires_at>now();if v_override is not null then v_limit:=v_override;end if;end if;
 insert into public.usage_counters values(p_user_id,v_month,0)on conflict do nothing;
 select ai_generations into v_count from public.usage_counters where user_id=p_user_id and period_start=v_month for update;
 -- Check quota before spacing: a fourth test request proves a quota block, not a rate-limit block.
 if v_count>=v_limit then raise exception 'QUOTA_EXCEEDED';end if;
 if exists(select 1 from public.ai_usage where user_id=p_user_id and created_at>now()-interval '10 seconds')then raise exception 'RATE_LIMIT';end if;
 if(select coalesce(sum(estimated_cost),0)from public.ai_usage where created_at>=v_day)+0.1>25 then raise exception 'GLOBAL_BUDGET_EXCEEDED';end if;
 update public.usage_counters set ai_generations=ai_generations+1 where user_id=p_user_id and period_start=v_month;
 insert into public.ai_usage(user_id,provider,model)values(p_user_id,p_provider,p_model)returning id into v_id;return v_id;
end;$$;
create or replace function public.staging_schema_status()returns jsonb language sql stable security definer set search_path=''as $$
select jsonb_build_object('versions',(select jsonb_agg(version order by version)from public.schema_versions),'tables',(select jsonb_agg(jsonb_build_object('name',t.name,'exists',c.oid is not null,'rls',coalesce(c.relrowsecurity,false),'policies',(select count(*)from pg_catalog.pg_policy where polrelid=c.oid)))from unnest(array['profiles','brands','contents','subscriptions','social_connections','publications','usage_counters'])t(name)left join pg_catalog.pg_class c on c.oid=to_regclass('public.'||t.name)),
 'token_select_blocked',not has_column_privilege('authenticated','public.social_connections','access_token_encrypted','SELECT'),
 'usage_write_blocked',not has_table_privilege('authenticated','public.usage_counters','UPDATE'),
 'quota_function_current',position('staging_usage_overrides'in pg_get_functiondef('public.reserve_ai_usage(uuid,text,text)'::regprocedure))>0,
 'staging_enabled',(select staging_validation_enabled from public.operating_settings where id));$$;
do $$declare t text;begin foreach t in array array['schema_versions','staging_checks','staging_accounts','staging_resources','staging_usage_overrides','billing_webhook_deliveries','publication_transitions']loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
grant usage,select on sequence public.publication_transitions_id_seq to service_role;
revoke all on function public.staging_set_usage_limit(uuid,uuid,boolean),public.staging_schema_status()from public,anon,authenticated;
grant execute on function public.staging_set_usage_limit(uuid,uuid,boolean),public.staging_schema_status()to service_role;
insert into public.schema_versions(version)values('002_phase3_operations'),('003_phase35_staging_validation')on conflict do nothing;
commit;
