-- Additive PHASE 3 migration. Apply after schema.sql. Back up/PITR before upgrade.
begin;
create table if not exists public.operating_settings(id boolean primary key default true check(id),allow_mock_billing boolean not null default false);
insert into public.operating_settings(id)values(true)on conflict do nothing;
alter table public.operating_settings enable row level security;
revoke all on public.operating_settings from anon,authenticated;
grant all on public.operating_settings to service_role;
create table if not exists public.billing_customers(user_id uuid primary key references auth.users(id) on delete cascade,provider_customer_id text not null unique);
alter table public.billing_customers enable row level security;
revoke all on public.billing_customers from anon,authenticated;
grant all on public.billing_customers to service_role;
create table if not exists public.plans (
 id text primary key check(id in ('FREE','STARTER','PRO','AGENCY')), price_krw integer not null,
 ai_limit integer not null, brand_limit integer not null, scheduled_publish boolean not null,
 repurposing boolean not null, analytics boolean not null
);
insert into public.plans values ('FREE',0,10,1,false,false,false),('STARTER',29000,100,1,true,false,false),('PRO',59000,500,3,true,true,true),('AGENCY',149000,2000,20,true,true,true) on conflict(id) do nothing;
create table if not exists public.subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id) on delete cascade,
 plan_id text not null references public.plans(id), provider text not null check(provider in ('mock','stripe','toss')),
 provider_subscription_id text unique, status text not null check(status in ('active','past_due','cancelled','incomplete')),
 current_period_end timestamptz not null, cancel_at_period_end boolean not null default false,
 last_event_at timestamptz not null default 'epoch', created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.usage_counters (
 user_id uuid not null references auth.users(id) on delete cascade, period_start date not null,
 ai_generations integer not null default 0 check(ai_generations>=0), primary key(user_id,period_start)
);
insert into public.usage_counters select user_id,date_trunc('month',created_at at time zone 'Asia/Seoul')::date,count(*) from public.ai_usage group by user_id,date_trunc('month',created_at at time zone 'Asia/Seoul')::date on conflict(user_id,period_start) do update set ai_generations=greatest(public.usage_counters.ai_generations,excluded.ai_generations);
create table if not exists public.billing_events (
 id uuid primary key default gen_random_uuid(), provider text not null, provider_event_id text not null,
 user_id uuid references auth.users(id) on delete set null, event_type text not null, status text not null check(status in ('processed','ignored','failed')),
 plan_id text, amount_krw integer, message text, created_at timestamptz not null default now(), unique(provider,provider_event_id)
);
create table if not exists public.social_connections (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null check(provider='threads'), provider_user_id text not null, username text not null,
 access_token_encrypted text not null, refresh_token_encrypted text, expires_at timestamptz not null,
 scopes text[] not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,provider)
);
create table if not exists public.oauth_states (
 state_hash text primary key, user_id uuid not null references auth.users(id) on delete cascade, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create table if not exists public.publications (
 id uuid primary key default gen_random_uuid(), content_id uuid not null, user_id uuid not null references auth.users(id) on delete cascade,
 provider text not null default 'threads' check(provider='threads'), status text not null check(status in ('pending','scheduled','publishing','published','failed')),
 provider_post_id text, provider_post_url text, provider_container_id text, scheduled_at timestamptz, published_at timestamptz,
 error_message text, retry_count integer not null default 0, attempt_count integer not null default 0,
 locked_until timestamptz, lock_token uuid, next_attempt_at timestamptz not null default now(), uncertain boolean not null default false,
 body_snapshot text not null check(char_length(body_snapshot) between 1 and 500),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(content_id,provider)
);
create unique index if not exists contents_id_user_idx on public.contents(id,user_id);
-- composite ownership on publications; no request can attach another user's content.
do $$ begin if not exists(select 1 from pg_constraint where conname='publications_content_owner_fk') then alter table public.publications add constraint publications_content_owner_fk foreign key(content_id,user_id) references public.contents(id,user_id) on delete cascade;end if;end $$;
alter table public.publications add column if not exists provider_post_url text;
create index if not exists publication_due_idx on public.publications(status,next_attempt_at,scheduled_at);
create table if not exists public.audit_logs (
 id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id) on delete set null,
 action text not null, resource_type text not null, resource_id text, metadata jsonb not null default '{}', created_at timestamptz not null default now()
);
create index if not exists audit_user_created_idx on public.audit_logs(user_id,created_at);
create table if not exists public.user_roles (user_id uuid primary key references auth.users(id) on delete cascade, role text not null check(role='admin'));
create table if not exists public.rate_limits (subject text not null, service text not null, window_start timestamptz not null, count integer not null, primary key(subject,service,window_start));
create index if not exists rate_limits_window_idx on public.rate_limits(window_start);
create table if not exists public.active_users (user_id uuid not null references auth.users(id) on delete cascade,day date not null,primary key(user_id,day));
alter table public.api_errors add column if not exists request_id uuid;
create unique index if not exists api_errors_request_id_idx on public.api_errors(request_id);

-- Authoritative entitlements, never read plan from cookies or user-editable metadata.
create or replace function public.effective_plan(p_user_id uuid) returns text language sql stable security definer set search_path='' as $$
 select coalesce((select s.plan_id from public.subscriptions s where s.user_id=p_user_id and s.status='active' and s.current_period_end>now() and (s.provider<>'mock' or (select allow_mock_billing from public.operating_settings where id))), 'FREE');
$$;
create or replace function public.is_active_brand(p_user_id uuid,p_brand_id uuid)returns boolean language sql stable security definer set search_path='' as $$
select exists(select 1 from(select id,row_number()over(order by created_at,id)as n from public.brands where user_id=p_user_id)b where b.id=p_brand_id and b.n<=(select brand_limit from public.plans where id=public.effective_plan(p_user_id)));$$;
revoke all on function public.is_active_brand(uuid,uuid)from public,anon,authenticated;
grant execute on function public.is_active_brand(uuid,uuid)to service_role;
create or replace function public.enforce_brand_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare lim integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,381));
 if tg_op='UPDATE' and old.user_id<>new.user_id then raise exception 'OWNER_IMMUTABLE';end if;
 select brand_limit into lim from public.plans where id=public.effective_plan(new.user_id);
 if tg_op='UPDATE' and not public.is_active_brand(new.user_id,new.id)then raise exception 'BRAND_ARCHIVED';end if;
 if tg_op='INSERT' and (select count(*) from public.brands where user_id=new.user_id)>=lim then raise exception 'BRAND_LIMIT';end if;
 return new;
end;$$;
drop trigger if exists brand_plan_limit on public.brands;
create trigger brand_plan_limit before insert or update on public.brands for each row execute function public.enforce_brand_limit();

create or replace function public.reserve_ai_usage(p_user_id uuid,p_provider text,p_model text) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;v_count integer;v_limit integer;v_month date:=date_trunc('month',now() at time zone 'Asia/Seoul')::date;v_day timestamptz:=date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
 if p_provider not in ('openai','gemini') then raise exception 'INVALID_PROVIDER';end if;
 perform pg_advisory_xact_lock(7310241);
 if exists(select 1 from public.ai_usage where user_id=p_user_id and created_at>now()-interval '10 seconds')then raise exception 'RATE_LIMIT';end if;
 select ai_limit into v_limit from public.plans where id=public.effective_plan(p_user_id);
 insert into public.usage_counters values(p_user_id,v_month,0) on conflict do nothing;
 select ai_generations into v_count from public.usage_counters where user_id=p_user_id and period_start=v_month for update;
 if v_count>=v_limit then raise exception 'QUOTA_EXCEEDED';end if;
 -- Global monetary safety fuse; paid plan monthly limits are NOT limited to the old 20/day cap.
 if (select coalesce(sum(estimated_cost),0) from public.ai_usage where created_at>=v_day)+0.1>25 then raise exception 'GLOBAL_BUDGET_EXCEEDED';end if;
 update public.usage_counters set ai_generations=ai_generations+1 where user_id=p_user_id and period_start=v_month;
 insert into public.ai_usage(user_id,provider,model) values(p_user_id,p_provider,p_model) returning id into v_id;return v_id;
end;$$;
create or replace function public.consume_rate_limits(p_subjects text[],p_service text,p_limit integer) returns boolean language plpgsql security definer set search_path='' as $$
declare s text;v_window timestamptz:=date_trunc('minute',now());
begin
 perform pg_advisory_xact_lock(7310243);
 if (select coalesce(sum(count),0)from public.rate_limits where window_start>=date_trunc('day',now()at time zone 'Asia/Seoul')at time zone 'Asia/Seoul')+cardinality(p_subjects)>20000 then return false;end if;
 foreach s in array p_subjects loop if coalesce((select count from public.rate_limits where subject=s and service=p_service and window_start=v_window),0)>=p_limit then return false;end if;end loop;
 foreach s in array p_subjects loop insert into public.rate_limits values(s,p_service,v_window,1) on conflict(subject,service,window_start) do update set count=public.rate_limits.count+1;end loop;
 return true;
end;$$;
create or replace function public.consume_oauth_state(p_hash text,p_user_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;begin delete from public.oauth_states where state_hash=p_hash and user_id=p_user_id and expires_at>now();get diagnostics n=row_count;return n=1;end;$$;
create or replace function public.enqueue_publication(p_user_id uuid,p_content_id uuid,p_scheduled_at timestamptz default null) returns uuid language plpgsql security definer set search_path='' as $$
declare v_content public.contents;v_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,381));
 if p_scheduled_at is not null and not (select scheduled_publish from public.plans where id=public.effective_plan(p_user_id))then raise exception 'PLAN_REQUIRED';end if;
 select * into v_content from public.contents where id=p_content_id and user_id=p_user_id for update;
 if not found then raise exception 'CONTENT_NOT_FOUND';end if;
 if not public.is_active_brand(p_user_id,v_content.brand_id)then raise exception 'BRAND_ARCHIVED';end if;
 if v_content.platform<>'threads' or char_length(v_content.body)>500 then raise exception 'THREADS_TEXT_LIMIT';end if;
 if p_scheduled_at is not null and (p_scheduled_at<now() or p_scheduled_at>now()+interval '1 year')then raise exception 'INVALID_SCHEDULE';end if;
 insert into public.publications(content_id,user_id,status,scheduled_at,body_snapshot)values(p_content_id,p_user_id,case when p_scheduled_at is null then 'pending' else 'scheduled' end,p_scheduled_at,v_content.body) returning id into v_id;
 update public.contents set status=case when p_scheduled_at is null then 'draft' else 'scheduled' end,scheduled_at=p_scheduled_at where id=p_content_id;
 return v_id;
end;$$;
create or replace function public.claim_publications(p_id uuid default null) returns setof public.publications language plpgsql security definer set search_path='' as $$
begin
 -- An expired lease may represent a successful upstream publish. Never blindly republish.
 update public.publications set status='failed',uncertain=true,error_message='게시 결과를 확인할 수 없습니다. Threads에서 확인 후 운영자에게 문의하세요.',updated_at=now() where status='publishing' and locked_until<now();
 return query with due as (
 select id from public.publications where (p_id is null or id=p_id) and status in ('pending','scheduled') and coalesce(scheduled_at,now())<=now() and next_attempt_at<=now() and retry_count<=3 order by created_at for update skip locked limit 1
 ) update public.publications p set status='publishing',attempt_count=attempt_count+1,locked_until=now()+interval '5 minutes',lock_token=gen_random_uuid(),updated_at=now() from due where p.id=due.id returning p.*;
end;$$;
create or replace function public.finish_publication(p_id uuid,p_lock_token uuid,p_post_id text) returns boolean language plpgsql security definer set search_path='' as $$
declare v public.publications;
begin
 update public.publications set status='published',uncertain=false,provider_post_id=p_post_id,published_at=now(),locked_until=null,updated_at=now(),error_message=null where id=p_id and status='publishing' and lock_token=p_lock_token returning * into v;
 if not found then return false;end if;
 update public.contents set status='published',published_at=now(),updated_at=now() where id=v.content_id and user_id=v.user_id;
 insert into public.audit_logs(user_id,action,resource_type,resource_id,metadata)values(v.user_id,'content.publish','publication',v.id::text,'{"provider":"threads","status":"published"}');return true;
end;$$;
create or replace function public.retry_publication(p_user_id uuid,p_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;begin
 update public.publications set status=case when scheduled_at is null then 'pending' else 'scheduled' end,retry_count=retry_count+1,next_attempt_at=now(),updated_at=now() where id=p_id and user_id=p_user_id and status='failed' and not uncertain and retry_count<3;
 get diagnostics n=row_count;return n=1;
end;$$;
-- Dedup and entitlement mutation happen in ONE transaction. Reject stale events.
create or replace function public.apply_billing_event(p_provider text,p_event_id text,p_type text,p_user_id uuid,p_plan text,p_subscription_id text,p_status text,p_period_end timestamptz,p_cancel boolean,p_event_at timestamptz,p_amount integer default null) returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,381));
 insert into public.billing_events(provider,provider_event_id,user_id,event_type,status,plan_id,amount_krw)values(p_provider,p_event_id,p_user_id,p_type,'processed',p_plan,p_amount) on conflict(provider,provider_event_id) do update set status='processed',user_id=excluded.user_id,event_type=excluded.event_type,plan_id=excluded.plan_id,amount_krw=excluded.amount_krw where public.billing_events.status='failed';
 get diagnostics n=row_count;if n=0 then return false;end if;
 if exists(select 1 from public.subscriptions where user_id=p_user_id and last_event_at>p_event_at)then update public.billing_events set status='ignored' where provider=p_provider and provider_event_id=p_event_id;return false;end if;
 insert into public.subscriptions(user_id,plan_id,provider,provider_subscription_id,status,current_period_end,cancel_at_period_end,last_event_at) values(p_user_id,p_plan,p_provider,p_subscription_id,p_status,p_period_end,p_cancel,p_event_at)
 on conflict(user_id) do update set plan_id=excluded.plan_id,provider=excluded.provider,provider_subscription_id=excluded.provider_subscription_id,status=excluded.status,current_period_end=excluded.current_period_end,cancel_at_period_end=excluded.cancel_at_period_end,last_event_at=excluded.last_event_at,updated_at=now();
 insert into public.audit_logs(user_id,action,resource_type,resource_id,metadata)values(p_user_id,'subscription.change','subscription',p_subscription_id,jsonb_build_object('plan',p_plan,'provider',p_provider,'status',p_status));return true;
end;$$;

create or replace function public.usage_summary()returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('today',count(*) filter(where created_at>=date_trunc('day',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'),'month',coalesce((select ai_generations from public.usage_counters where user_id=(select auth.uid()) and period_start=date_trunc('month',now() at time zone 'Asia/Seoul')::date),0),'estimated_cost',coalesce(sum(estimated_cost),0),'reserved',count(*) filter(where status in ('pending','failed')),'input_tokens',coalesce(sum(input_tokens),0),'output_tokens',coalesce(sum(output_tokens),0)) from public.ai_usage where user_id=(select auth.uid()) and created_at>=date_trunc('month',now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';$$;

create table if not exists public.checkout_attempts(user_id uuid primary key references auth.users(id) on delete cascade,id uuid not null default gen_random_uuid(),plan_id text not null references public.plans(id),expires_at timestamptz not null);
alter table public.checkout_attempts enable row level security;
revoke all on public.checkout_attempts from anon,authenticated;
grant all on public.checkout_attempts to service_role;
create or replace function public.claim_checkout(p_user_id uuid,p_plan text)returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.checkout_attempts;
begin perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,381));
insert into public.checkout_attempts(user_id,plan_id,expires_at)values(p_user_id,p_plan,date_trunc('second',now())+interval '31 minutes')on conflict(user_id)do update set id=gen_random_uuid(),plan_id=excluded.plan_id,expires_at=excluded.expires_at where public.checkout_attempts.expires_at<now();
select * into r from public.checkout_attempts where user_id=p_user_id;return to_jsonb(r);end;$$;
revoke all on function public.claim_checkout(uuid,text)from public,anon,authenticated;
grant execute on function public.claim_checkout(uuid,text)to service_role;

create or replace function public.admin_metrics()returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object(
 'users',(select count(*)from public.profiles),
 'paid_users',(select count(*)from public.subscriptions where status='active'and current_period_end>now()and provider<>'mock'),
 'mrr_krw',(select coalesce(sum(p.price_krw),0)from public.subscriptions s join public.plans p on p.id=s.plan_id where s.status='active'and s.current_period_end>now()and s.provider<>'mock'and not s.cancel_at_period_end),
 'plans',(select jsonb_object_agg(id,n)from(select p.id,case when p.id='FREE'then(select count(*)from public.profiles)-(select count(*)from public.subscriptions where status='active'and current_period_end>now()and provider<>'mock')else count(s.id)end n from public.plans p left join public.subscriptions s on s.plan_id=p.id and s.status='active'and s.current_period_end>now()and s.provider<>'mock' group by p.id)x),
 'dau',(select count(*)from public.active_users where day=(now()at time zone 'Asia/Seoul')::date),
 'mau',(select count(distinct user_id)from public.active_users where day>=date_trunc('month',now()at time zone 'Asia/Seoul')::date),
 'contents_created',(select count(*)from public.contents),
 'ai_generations',(select count(*)from public.ai_usage),
 'estimated_ai_cost',(select coalesce(sum(estimated_cost),0)from public.ai_usage),
 'publications',(select count(*)from public.publications),
 'published',(select count(*)from public.publications where status='published'),
 'failed',(select count(*)from public.publications where status='failed'),
 'publication_success_rate',(select coalesce(round(100.0*count(*)filter(where status='published')/nullif(count(*)filter(where status in('published','failed')),0),2),0)from public.publications),
 'publication_failure_rate',(select coalesce(round(100.0*count(*)filter(where status='failed')/nullif(count(*)filter(where status in('published','failed')),0),2),0)from public.publications));$$;
create or replace function public.user_metrics(p_user_id uuid)returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('contents_created',(select count(*)from public.contents where user_id=p_user_id),'ai_generations',(select count(*)from public.ai_usage where user_id=p_user_id),'publications',count(*),'published',count(*)filter(where status='published'),'failed',count(*)filter(where status='failed'),'publication_success_rate',coalesce(round(100.0*count(*)filter(where status='published')/nullif(count(*)filter(where status in('published','failed')),0),2),0))from public.publications where user_id=p_user_id;$$;
revoke all on function public.admin_metrics(),public.user_metrics(uuid)from public,anon,authenticated;
grant execute on function public.admin_metrics(),public.user_metrics(uuid)to service_role;

create or replace function public.protect_queued_content()returns trigger language plpgsql security definer set search_path='' as $$begin if exists(select 1 from public.publications where content_id=old.id and status in('pending','scheduled','publishing'))then raise exception 'PUBLICATION_PENDING';end if;return old;end;$$;
drop trigger if exists content_queued_guard on public.contents;
create trigger content_queued_guard before delete on public.contents for each row execute function public.protect_queued_content();
revoke all on function public.protect_queued_content()from public,anon,authenticated;

-- RLS everywhere. Client roles cannot change entitlements, counters, jobs or tokens.
do $$ declare t text;begin foreach t in array array['plans','subscriptions','usage_counters','billing_events','social_connections','oauth_states','publications','audit_logs','user_roles','rate_limits','active_users']loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);end loop;end $$;
grant select on public.plans to authenticated;
drop policy if exists read_plans on public.plans;create policy read_plans on public.plans for select to authenticated using(true);
do $$ declare t text;begin foreach t in array array['subscriptions','usage_counters','billing_events','publications','audit_logs']loop execute format('drop policy if exists own_read on public.%I',t);execute format('create policy own_read on public.%I for select to authenticated using((select auth.uid())=user_id)',t);execute format('grant select on public.%I to authenticated',t);end loop;end $$;
grant select(id,user_id,provider,provider_user_id,username,expires_at,scopes,created_at,updated_at) on public.social_connections to authenticated;
drop policy if exists own_read on public.social_connections;create policy own_read on public.social_connections for select to authenticated using((select auth.uid())=user_id);
-- Tables with no client policies: oauth_states, roles, rate limits, activity.
revoke all on function public.effective_plan(uuid),public.enforce_brand_limit(),public.consume_rate_limits(text[],text,integer),public.consume_oauth_state(text,uuid),public.enqueue_publication(uuid,uuid,timestamptz),public.claim_publications(uuid),public.finish_publication(uuid,uuid,text),public.retry_publication(uuid,uuid),public.apply_billing_event(text,text,text,uuid,text,text,text,timestamptz,boolean,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.effective_plan(uuid),public.consume_rate_limits(text[],text,integer),public.consume_oauth_state(text,uuid),public.enqueue_publication(uuid,uuid,timestamptz),public.claim_publications(uuid),public.finish_publication(uuid,uuid,text),public.retry_publication(uuid,uuid),public.apply_billing_event(text,text,text,uuid,text,text,text,timestamptz,boolean,timestamptz,integer) to service_role;
commit;
