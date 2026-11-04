-- The scheduled launch sends (Nov 4, Nick: launch email at 7:00, the personal notes at 7:05). Each step is armed with a
-- time; /api/cron/launch-send claims a due step once (started_at) and sends. The database's clock calls it every minute
-- (pg_cron + pg_net); the route does nothing until something is armed and due.
create table if not exists public.launch_schedule (
  step text primary key check (step in ('launch', 'personal')),
  run_at timestamptz not null,
  armed_by text,
  armed_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  cancelled_at timestamptz,
  result jsonb
);
alter table public.launch_schedule enable row level security;
revoke all on public.launch_schedule from anon, authenticated;
