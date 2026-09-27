-- AI + CRM groundwork.
--   activities      one timeline per customer: emails in/out, calls, notes, meetings, tasks
--   ai_suggestions  the Assistant inbox: follow-ups from the rules engine today, AI suggestions later
--   ai_runs         a log of every AI call (task, model, tokens, errors) so cost and quality can be checked
--   customers       CRM fields: tags, next follow-up date, account owner, last contact
-- All staff-only. Customers never read these tables.

-- ---------------------------------------------------------------
-- Activity timeline
-- ---------------------------------------------------------------
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  kind text not null check (kind in ('note','call','email','meeting','task','sms')),
  direction text not null default 'none' check (direction in ('in','out','none')),
  subject text not null default '',
  body text not null default '' check (length(body) <= 100000),
  from_email text not null default '',
  to_email text not null default '',
  -- email Message-ID (or another system's id), so the same email is never stored twice
  external_id text unique,
  thread_id text,
  occurred_at timestamptz not null default now(),
  -- set once the AI has read this (e.g. looked for an order in an email)
  ai_processed_at timestamptz,
  meta jsonb not null default '{}'::jsonb,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists activities_customer_idx on public.activities (customer_id, occurred_at desc);
create index if not exists activities_order_idx on public.activities (order_id, occurred_at desc);
create index if not exists activities_unprocessed_idx on public.activities (occurred_at) where kind = 'email' and direction = 'in' and ai_processed_at is null;
alter table public.activities enable row level security;
drop policy if exists activities_staff on public.activities;
create policy activities_staff on public.activities for all using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------
-- Assistant inbox (follow-ups and suggestions)
-- ---------------------------------------------------------------
create table if not exists public.ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  source text not null default 'rules' check (source in ('rules','ai','staff')),
  status text not null default 'open' check (status in ('open','snoozed','done','dismissed')),
  priority smallint not null default 2 check (priority between 1 and 3),
  -- one row per situation, e.g. 'quote_followup:<order id>:<sent at>', so a dismissed follow-up stays dismissed
  dedupe_key text unique,
  customer_id uuid references public.customers(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  activity_id uuid references public.activities(id) on delete set null,
  title text not null default '',
  body text not null default '',
  -- a ready-to-send message: { channel: 'portal' | 'email', subject, body }
  draft jsonb not null default '{}'::jsonb,
  -- anything else the suggestion carries, e.g. proposed order groups from an email
  payload jsonb not null default '{}'::jsonb,
  due_at timestamptz,
  snoozed_until timestamptz,
  model text,
  run_id uuid,
  decided_at timestamptz,
  decided_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_suggestions_open_idx on public.ai_suggestions (status, priority, created_at desc);
create index if not exists ai_suggestions_order_idx on public.ai_suggestions (order_id);
create index if not exists ai_suggestions_customer_idx on public.ai_suggestions (customer_id);
drop trigger if exists ai_suggestions_touch on public.ai_suggestions;
create trigger ai_suggestions_touch before update on public.ai_suggestions
  for each row execute function public.touch_updated_at();
alter table public.ai_suggestions enable row level security;
drop policy if exists ai_suggestions_staff on public.ai_suggestions;
create policy ai_suggestions_staff on public.ai_suggestions for all using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------
-- AI call log
-- ---------------------------------------------------------------
create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  task text not null,
  model text not null default '',
  status text not null default 'ok' check (status in ('ok','error','skipped')),
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  ms int not null default 0,
  error text,
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  activity_id uuid references public.activities(id) on delete set null,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_runs_created_idx on public.ai_runs (created_at desc);
alter table public.ai_runs enable row level security;
drop policy if exists ai_runs_staff_read on public.ai_runs;
create policy ai_runs_staff_read on public.ai_runs for select using (public.is_staff());

-- ---------------------------------------------------------------
-- Customer CRM fields
-- ---------------------------------------------------------------
alter table public.customers add column if not exists tags text[] not null default '{}';
alter table public.customers add column if not exists next_follow_up date;
alter table public.customers add column if not exists owner_email text not null default '';
alter table public.customers add column if not exists last_contact_at timestamptz;
create index if not exists customers_follow_up_idx on public.customers (next_follow_up) where next_follow_up is not null;

-- keep last_contact_at fresh from messages and logged activities
create or replace function public.touch_customer_contact() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; ts timestamptz;
begin
  if tg_table_name = 'activities' then
    cid := new.customer_id;
    ts := new.occurred_at;
  else
    cid := coalesce(new.customer_id, (select customer_id from public.orders where id = new.order_id));
    ts := new.created_at;
  end if;
  if cid is not null then
    update public.customers set last_contact_at = greatest(coalesce(last_contact_at, 'epoch'::timestamptz), coalesce(ts, now()))
    where id = cid;
  end if;
  return new;
end $$;
revoke all on function public.touch_customer_contact() from public, anon, authenticated;
drop trigger if exists activities_contact on public.activities;
create trigger activities_contact after insert on public.activities for each row execute function public.touch_customer_contact();
drop trigger if exists messages_contact on public.messages;
create trigger messages_contact after insert on public.messages for each row execute function public.touch_customer_contact();

-- backfill last contact from existing messages
update public.customers c set last_contact_at = x.last_at
from (
  select coalesce(m.customer_id, o.customer_id) as cid, max(m.created_at) as last_at
  from public.messages m left join public.orders o on o.id = m.order_id
  group by 1
) x where x.cid = c.id and c.last_contact_at is null;

-- ---------------------------------------------------------------
-- Security advisor fixes
-- ---------------------------------------------------------------
alter function public.auth_email() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
alter function public.orders_completed_at() set search_path = public;
-- trigger-only function: nobody needs to call it through the API
revoke all on function public.log_order_created() from public, anon, authenticated;
