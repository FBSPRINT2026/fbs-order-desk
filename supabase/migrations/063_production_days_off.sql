-- Days a crew or a press isn't running (vacation, no crew, maintenance). The calendar skips them: work booked there
-- moves to the next day it runs, and suggestions don't pick them.
create table if not exists production_days_off (
  id uuid primary key default gen_random_uuid(),
  crew_id text,          -- a crew (Settings → Production → Crews): every press that crew runs is off
  machine text,          -- or one machine
  day date not null,
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  check (crew_id is not null or machine is not null)
);
create index if not exists production_days_off_day on production_days_off (day);
alter table production_days_off enable row level security;
drop policy if exists production_days_off_staff on production_days_off;
create policy production_days_off_staff on production_days_off for all using (is_staff()) with check (is_staff());
