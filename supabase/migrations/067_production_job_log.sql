-- Job start / stop logs on the production calendar: when a booked job actually started, paused, how far along it is,
-- and when it finished. Started jobs stay put when the schedule is re-planned; jobs not started can move.
alter table production_slots drop constraint if exists production_slots_status_check;
alter table production_slots add constraint production_slots_status_check check (status in ('scheduled', 'running', 'paused', 'done'));
alter table production_slots
  add column if not exists started_at timestamptz,
  add column if not exists finished_at timestamptz,
  add column if not exists progress numeric not null default 0 check (progress >= 0 and progress <= 1),
  add column if not exists progress_at timestamptz,
  -- which print locations this booking covers (fronts one day, backs the next / on another press); null = all of them
  add column if not exists locations text[];

create table if not exists production_slot_log (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid references production_slots(id) on delete set null,
  order_id uuid,
  machine text not null default '',
  action text not null check (action in ('start', 'pause', 'resume', 'progress', 'done', 'not_started', 'reopen')),
  progress numeric,
  note text not null default '',
  at timestamptz not null default now(),
  by text not null default ''
);
create index if not exists production_slot_log_slot on production_slot_log (slot_id, at);
create index if not exists production_slot_log_at on production_slot_log (at);
alter table production_slot_log enable row level security;
drop policy if exists production_slot_log_staff on production_slot_log;
create policy production_slot_log_staff on production_slot_log for all using (is_staff()) with check (is_staff());
