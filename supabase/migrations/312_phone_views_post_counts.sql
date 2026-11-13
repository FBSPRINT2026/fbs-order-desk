-- Phone logins by job (Nick, Nov 13 2026): what each person's phone shows first, and the catcher's post count.

-- receiving / press / assist / catcher / office (lib/crewView.ts); null = their place on a press crew says it
alter table public.employees add column if not exists phone_view text;

-- the count at the end of the oven (the catcher's), started from the count-in so only what's different is typed
create table if not exists public.post_counts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  archived_order_id uuid references public.archived_orders(id) on delete cascade,
  -- [{ style, color, size, pre, post, reject }]: pre = the count-in (fixed when it was wrong), post = here now
  lines jsonb not null default '[]'::jsonb,
  pre integer not null default 0,
  post integer not null default 0,
  rejects integer not null default 0,
  -- all_here: every piece accounted for; short: fewer, no reprint (a reseller's waste); reprint: the rejects print again
  outcome text not null default 'all_here' check (outcome in ('all_here', 'short', 'reprint')),
  pre_fixed boolean not null default false,
  note text not null default '',
  by text not null default '',
  created_at timestamptz not null default now(),
  constraint post_counts_job check (order_id is not null or archived_order_id is not null)
);
create index if not exists post_counts_order_idx on public.post_counts (order_id, created_at desc);
create index if not exists post_counts_archived_idx on public.post_counts (archived_order_id, created_at desc);
alter table public.post_counts enable row level security;
drop policy if exists post_counts_staff on public.post_counts;
create policy post_counts_staff on public.post_counts for all using ((select public.is_staff())) with check ((select public.is_staff()));

-- A fix to someone's own time card, asked for from their phone ("I forgot to clock out for lunch, I took 30 minutes"),
-- waiting for a manager (Jose) to approve it on the Time Clock; approved, it becomes the punch it asks for (the original
-- kept, as every punch edit is).
create table if not exists public.time_fix_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  day date not null,
  -- lunch: a lunch not punched (start + minutes); missed_in / missed_out: a punch they forgot; other: the note says it
  kind text not null check (kind in ('lunch', 'missed_in', 'missed_out', 'other')),
  at timestamptz,
  minutes integer,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by text,
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists time_fix_requests_open on public.time_fix_requests (status, created_at desc);
create index if not exists time_fix_requests_emp on public.time_fix_requests (employee_id, day);
alter table public.time_fix_requests enable row level security;
drop policy if exists time_fix_requests_staff on public.time_fix_requests;
create policy time_fix_requests_staff on public.time_fix_requests for all using ((select public.is_staff())) with check ((select public.is_staff()));
