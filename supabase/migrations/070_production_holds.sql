-- Planner: jobs we know are coming (quick specs + in-hands date) that hold time on the production calendar before
-- there's an order. Their time is booked like any job (production_slots.hold_id), so "When can we print it?" and
-- Re-plan see it as taken. Remove the hold when the real order is booked.
create table if not exists production_holds (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  customer text not null default '',
  spec jsonb not null default '{}'::jsonb,
  due_date date,
  due_time smallint check (due_time is null or (due_time >= 0 and due_time < 1440)),
  notes text not null default '',
  status text not null default 'planned' check (status in ('planned', 'done', 'cancelled')),
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table production_holds enable row level security;
drop policy if exists production_holds_staff on production_holds;
create policy production_holds_staff on production_holds for all using (public.is_staff()) with check (public.is_staff());
alter table production_slots add column if not exists hold_id uuid references production_holds(id) on delete cascade;
create index if not exists production_slots_hold_idx on production_slots (hold_id);
