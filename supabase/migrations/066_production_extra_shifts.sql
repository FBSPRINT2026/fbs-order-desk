-- Extra shifts outside a press's regular schedule, e.g. a Saturday 10 AM - 2 PM shift when the schedule is too tight.
create table if not exists production_extra_shifts (
  id uuid primary key default gen_random_uuid(),
  machine text not null,
  crew_id text,
  day date not null,
  start_min int not null check (start_min >= 0 and start_min < 1440),
  end_min int not null check (end_min > start_min and end_min <= 1440),
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists production_extra_shifts_day on production_extra_shifts (day);
alter table production_extra_shifts enable row level security;
drop policy if exists production_extra_shifts_staff on production_extra_shifts;
create policy production_extra_shifts_staff on production_extra_shifts for all using (is_staff()) with check (is_staff());
