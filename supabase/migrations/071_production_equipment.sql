-- Equipment Status: what's wrong with a press or machine right now, set by the production manager. Two heads out on
-- an 8-color press → it runs 6 colors until fixed; running slow → jobs take longer; down → nothing booked on it runs
-- until it's back. The calendar, Re-plan, suggestions and "When can we print it?" all use the working numbers.
create table if not exists production_equipment (
  machine text primary key,
  colors_working smallint check (colors_working is null or colors_working >= 0),
  speed smallint check (speed is null or (speed > 0 and speed <= 200)),
  down boolean not null default false,
  note text not null default '',
  since date,
  until date,
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
alter table production_equipment enable row level security;
drop policy if exists production_equipment_staff on production_equipment;
create policy production_equipment_staff on production_equipment for all using (public.is_staff()) with check (public.is_staff());

-- every change, for looking back at how often a press has been down
create table if not exists production_equipment_log (
  id uuid primary key default gen_random_uuid(),
  machine text not null,
  colors_working smallint,
  speed smallint,
  down boolean not null default false,
  note text not null default '',
  until date,
  cleared boolean not null default false,
  by text not null default '',
  at timestamptz not null default now()
);
alter table production_equipment_log enable row level security;
drop policy if exists production_equipment_log_staff on production_equipment_log;
create policy production_equipment_log_staff on production_equipment_log for all using (public.is_staff()) with check (public.is_staff());
create index if not exists production_equipment_log_machine_idx on production_equipment_log (machine, at desc);
