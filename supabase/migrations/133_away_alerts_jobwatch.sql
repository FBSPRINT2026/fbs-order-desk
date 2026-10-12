-- Away mode, phone alerts and the Job watcher (Oct 12, Nick: "a mode where we're not monitoring email… only tell us
-- when something super urgent… alert me on my phone without having it open"; "every job has a due date… remind to ask
-- for sizes, haven't seen art in two days, order goods today or it's too late").
-- Additive only.

-- who's away, and which alerts each person gets ({ "jobs": true, "goods": true } — missing = on for the owners)
alter table public.staff add column if not exists away_on boolean not null default false;
alter table public.staff add column if not exists away_since timestamptz;
alter table public.staff add column if not exists alerts jsonb not null default '{}'::jsonb;

-- the portal's own keys (the push signing key): server only
create table if not exists public.app_keys (
  name text primary key,
  value jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.app_keys enable row level security;

-- phones / computers that turned alerts on (one row per browser): server only
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  device text not null default '',
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  last_error text
);
create index if not exists push_subs_email on public.push_subs (email);
alter table public.push_subs enable row level security;

-- every alert sent (or held for the morning): what, why, where it opens; dedupe_key keeps it to once
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  kind text not null,                 -- email | job
  title text not null,
  body text not null default '',
  url text not null default '',
  dedupe_key text unique,
  order_id uuid,
  mail_inbox_id uuid,
  created_at timestamptz not null default now(),
  pushed_at timestamptz,
  push_result text,
  seen_at timestamptz
);
create index if not exists alerts_owner on public.alerts (owner, created_at desc);
alter table public.alerts enable row level security;

-- Away mode: each Inbox email read for urgency once
alter table public.mail_inbox add column if not exists watched_at timestamptz;

-- Job watcher to-dos: one per job + step per person (ref = job:<order id>:<step>)
alter table public.tasks add column if not exists ref text;
create unique index if not exists tasks_owner_ref on public.tasks (owner, ref) where ref is not null and status = 'open';

-- every 5 minutes (with the sync token, like the mail cache)
create or replace function public.away_tick() returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare t uuid;
begin
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/away/tick', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
end $$;
select cron.schedule('away-tick', '*/5 * * * *', 'select public.away_tick()');
