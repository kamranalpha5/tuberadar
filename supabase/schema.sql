-- TubeRadar backend schema (Supabase / Postgres). Run once in Supabase → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.

-- ========== tables ==========
create table if not exists public.plans (
  id text primary key,
  name text not null,
  price_usd numeric not null default 0,
  price_pkr numeric not null default 0,
  period_days int not null default 30,
  daily_credits int not null default 100,
  daily_json int not null default 1,
  radar_visible int,            -- null = all channels visible, otherwise first N per list (rest blurred)
  avp_visible int,
  max_seats int,                -- shared plans: max users per shared group
  shared boolean not null default false,
  features text[] not null default '{}',
  highlight boolean not null default false,
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  plan_id text not null default 'free' references public.plans(id),
  plan_expires_at timestamptz,
  shared_group int,
  is_admin boolean not null default false,
  banned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.usage (
  user_id uuid references public.profiles(id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  credits_used int not null default 0,
  json_used int not null default 0,
  json_open_until timestamptz,   -- a strategy JSON run is open: its AI calls are included
  json_calls int not null default 0,
  primary key (user_id, day)
);
alter table public.usage add column if not exists json_open_until timestamptz;
alter table public.usage add column if not exists json_calls int not null default 0;

create table if not exists public.payment_methods (
  id bigserial primary key,
  kind text not null default 'easypaisa',   -- easypaisa | jazzcash | bank | other
  title text not null,
  account_name text,
  account_number text,
  iban text,
  bank_name text,
  qr_url text,
  instructions text,
  active boolean not null default true,
  sort int not null default 0
);

create table if not exists public.payments (
  id bigserial primary key,
  user_id uuid references public.profiles(id) on delete set null,
  email text,
  plan_id text references public.plans(id),
  method_id bigint references public.payment_methods(id) on delete set null,
  amount_text text,
  tid text not null,
  screenshot_url text,
  status text not null default 'pending',  -- pending | approved | rejected
  note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);
create unique index if not exists payments_tid_unique on public.payments (lower(tid));

create table if not exists public.site_settings (
  id int primary key default 1 check (id = 1),
  site_name text not null default 'TubeRadar',
  tagline text default 'Find new viral YouTube channels before everyone else',
  business_name text default 'NexGen Automation',
  whatsapp text default '0340-9301597',
  contact_email text default '',
  announcement text default '',
  auto_activate boolean not null default false,
  credit_costs jsonb not null default '{"yt_per_10_units":1,"transcript":10,"rewrite":15,"analyze":10,"strategy":0,"chat":3,"topics":40}',
  niches text[] not null default array['personal finance','investing for beginners','side hustle','ai tools','make money online','true crime','history documentary','stoicism','horror stories','space documentary','tech review','real estate','luxury lifestyle','celebrity news','minecraft','football highlights','motivation','facts you didn''t know'],
  collector jsonb not null default '{"regions":["US","GB","CA","AU"],"relevanceLanguage":"en","minViews":3000,"minOutlier":2,"newChannelMaxAgeDays":90,"maxProfilesPerRun":120}',
  legal jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.app_secrets (
  id int primary key default 1 check (id = 1),
  youtube_key text,             -- used by the website (via the api function)
  youtube_collector_key text,   -- used by the GitHub collector (optional; else GitHub secret YT_API_KEY)
  gemini_key text,
  gemini_model text default 'gemini-3.8-flash',
  updated_at timestamptz not null default now()
);

-- accumulated breakout channels (collector upserts; api serves 24h/7d/30d/90d lists)
create table if not exists public.radar_channels (
  id text primary key,
  data jsonb not null,
  niche text,
  tier1 boolean not null default false,
  best_outlier numeric not null default 0,
  breakout_at timestamptz,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists radar_channels_breakout_at on public.radar_channels (breakout_at desc);

create table if not exists public.radar_snapshot (
  id int primary key default 1 check (id = 1),
  generated_at timestamptz,
  avp_generated_at timestamptz,
  avp jsonb not null default '[]',
  history jsonb not null default '[]',
  total_channels bigint not null default 0
);

create table if not exists public.yt_cache (k text primary key, v jsonb not null, at timestamptz not null default now());
create table if not exists public.transcripts (video_id text primary key, text text not null, at timestamptz not null default now());

-- ========== default rows ==========
insert into public.plans (id, name, price_usd, price_pkr, daily_credits, daily_json, radar_visible, avp_visible, max_seats, shared, features, highlight, sort) values
 ('free','Free',0,0,100,1,2,2,null,false,array['2 viral growing channels a day (rest blurred)','1 strategy JSON a day','100 map credits a day','Map chat & transcripts use credits'],false,0),
 ('starter_shared','Starter (Shared)',2,600,300,5,null,null,5,true,array['All new viral channels, 24h / 7d / 30d / 90d','All AVP channels','300 credits a day per user','5 strategy JSON a day','Shared plan: max 5 users per group'],false,1),
 ('starter_private','Starter (Private)',7,2000,800,15,null,null,null,false,array['Everything in Starter','800 credits a day, only for you','15 strategy JSON a day','Topics generator'],true,2),
 ('max','Max (Private)',10,2900,2000,50,null,null,null,false,array['Everything in Starter Private','2,000 credits a day','50 strategy JSON a day','Priority support on WhatsApp'],false,3)
on conflict (id) do nothing;
insert into public.site_settings (id) values (1) on conflict (id) do nothing;
insert into public.app_secrets (id) values (1) on conflict (id) do nothing;
insert into public.radar_snapshot (id) values (1) on conflict (id) do nothing;

-- ========== helpers ==========
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as
$$ select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;

-- new auth user -> profile row
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- activate a plan for a user (used by approve + auto-activate). Shared plans get a group with a free seat.
create or replace function public.activate_plan(p_user uuid, p_plan text) returns void language plpgsql security definer set search_path = public as $$
declare pl public.plans; g int; seats int;
begin
  select * into pl from public.plans where id = p_plan;
  if pl.id is null then raise exception 'unknown plan'; end if;
  if pl.shared then
    seats := coalesce(pl.max_seats, 5);
    select shared_group into g from public.profiles
      where plan_id = p_plan and shared_group is not null and plan_expires_at > now() and id <> p_user
      group by shared_group having count(*) < seats order by shared_group limit 1;
    if g is null then select coalesce(max(shared_group),0)+1 into g from public.profiles where plan_id = p_plan; end if;
  end if;
  update public.profiles set plan_id = p_plan,
    plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + make_interval(days => pl.period_days),
    shared_group = case when pl.shared then g else null end
  where id = p_user;
end $$;

create or replace function public.approve_payment(p_id bigint) returns void language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into p from public.payments where id = p_id;
  if p.status = 'approved' then return; end if;
  perform public.activate_plan(p.user_id, p.plan_id);
  update public.payments set status = 'approved', reviewed_at = now() where id = p_id;
end $$;

create or replace function public.reject_payment(p_id bigint, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare p public.payments;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  select * into p from public.payments where id = p_id;
  -- if it had been auto-activated, take the plan back
  if p.status = 'approved' then update public.profiles set plan_id = 'free', plan_expires_at = null, shared_group = null where id = p.user_id and plan_id = p.plan_id; end if;
  update public.payments set status = 'rejected', note = p_note, reviewed_at = now() where id = p_id;
end $$;

-- ========== row level security ==========
alter table public.plans enable row level security;
alter table public.profiles enable row level security;
alter table public.usage enable row level security;
alter table public.payment_methods enable row level security;
alter table public.payments enable row level security;
alter table public.site_settings enable row level security;
alter table public.app_secrets enable row level security;
alter table public.radar_channels enable row level security;
alter table public.radar_snapshot enable row level security;
alter table public.yt_cache enable row level security;
alter table public.transcripts enable row level security;

drop policy if exists plans_read on public.plans;            create policy plans_read on public.plans for select using (true);
drop policy if exists plans_admin on public.plans;           create policy plans_admin on public.plans for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists pm_read on public.payment_methods;     create policy pm_read on public.payment_methods for select using (active or public.is_admin());
drop policy if exists pm_admin on public.payment_methods;    create policy pm_admin on public.payment_methods for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists ss_read on public.site_settings;       create policy ss_read on public.site_settings for select using (true);
drop policy if exists ss_admin on public.site_settings;      create policy ss_admin on public.site_settings for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists sec_admin on public.app_secrets;       create policy sec_admin on public.app_secrets for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists prof_self on public.profiles;          create policy prof_self on public.profiles for select using (id = auth.uid() or public.is_admin());
drop policy if exists prof_admin on public.profiles;         create policy prof_admin on public.profiles for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists usage_self on public.usage;            create policy usage_self on public.usage for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists usage_admin on public.usage;           create policy usage_admin on public.usage for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists pay_self on public.payments;           create policy pay_self on public.payments for select using (user_id = auth.uid() or public.is_admin());
drop policy if exists pay_admin on public.payments;          create policy pay_admin on public.payments for update using (public.is_admin()) with check (public.is_admin());
-- radar tables, cache, transcripts: no client policies (only the api function / collector with the service role key)
-- note: users never insert payments directly; the api function does it so auto-activate can't be abused.

-- ========== storage (payment screenshots + QR codes) ==========
insert into storage.buckets (id, name, public) values ('public-assets', 'public-assets', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false) on conflict (id) do nothing;
drop policy if exists "qr admin write" on storage.objects;
create policy "qr admin write" on storage.objects for all using (bucket_id = 'public-assets' and public.is_admin()) with check (bucket_id = 'public-assets' and public.is_admin());
drop policy if exists "proof upload own" on storage.objects;
create policy "proof upload own" on storage.objects for insert with check (bucket_id = 'payment-proofs' and auth.uid()::text = (storage.foldername(name))[1]);
drop policy if exists "proof read" on storage.objects;
create policy "proof read" on storage.objects for select using (bucket_id = 'payment-proofs' and (public.is_admin() or auth.uid()::text = (storage.foldername(name))[1]));

-- ========== make yourself admin (run AFTER you sign up on the website) ==========
-- update public.profiles set is_admin = true where email = 'YOUR-EMAIL@gmail.com';

-- atomic credit/JSON counter used by the api function (service role only)
drop function if exists public.use_credits(uuid,int,int,int,int);
create or replace function public.use_credits(p_user uuid, p_credits int, p_limit int, p_json int default 0, p_json_limit int default 0)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d date := (now() at time zone 'utc')::date; c int; j int;
begin
  insert into public.usage (user_id, day) values (p_user, d) on conflict do nothing;
  select u.credits_used, u.json_used into c, j from public.usage u where u.user_id = p_user and u.day = d for update;
  if c + p_credits > p_limit or (p_json > 0 and j + p_json > p_json_limit) then
    return jsonb_build_object('ok', false, 'credits_used', c, 'json_used', j);
  end if;
  update public.usage u set credits_used = c + p_credits, json_used = j + p_json where u.user_id = p_user and u.day = d;
  return jsonb_build_object('ok', true, 'credits_used', c + p_credits, 'json_used', j + p_json);
end $$;
revoke execute on function public.use_credits(uuid,int,int,int,int) from public, anon, authenticated;
revoke execute on function public.activate_plan(uuid,text) from public, anon, authenticated;

-- admin: give / change / remove a user's plan by hand
create or replace function public.admin_set_plan(p_user uuid, p_plan text, p_days int) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_plan = 'free' then update public.profiles set plan_id = 'free', plan_expires_at = null, shared_group = null where id = p_user; return; end if;
  update public.profiles set plan_expires_at = null where id = p_user;
  perform public.activate_plan(p_user, p_plan);
  update public.profiles set plan_expires_at = now() + make_interval(days => coalesce(p_days, 30)) where id = p_user;
end $$;
