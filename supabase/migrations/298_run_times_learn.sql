-- Run times staff set on the schedule, and what every run teaches about each press operator's pace (Nov 9, Nick:
-- "the ability to override this page for time… you should be learning from that… learning by press operator")
alter table public.orders add column if not exists run_times jsonb;
create table if not exists public.run_lessons (
  id uuid primary key default gen_random_uuid(),
  order_id uuid,
  slot_id uuid,
  machine text not null default '',
  crew_id text,
  operator uuid,
  location text not null default '',
  kind text not null check (kind in ('ran', 'said')),
  est_min numeric not null,
  real_min numeric not null,
  qty integer,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists run_lessons_op on public.run_lessons (operator, created_at desc);
create index if not exists run_lessons_crew on public.run_lessons (crew_id, created_at desc);
alter table public.run_lessons enable row level security;
drop policy if exists run_lessons_staff on public.run_lessons;
create policy run_lessons_staff on public.run_lessons for all using (is_staff()) with check (is_staff());
