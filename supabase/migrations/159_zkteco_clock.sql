-- ZKTeco wall clock (SpeedFace-V4L, Oct 16 2026): the clock sends punches to /iclock/* (ZKTeco "ADMS" push).
--   timeclock_devices   + kind ('tablet' | 'zk'), serial, info (what the clock reports), the last stamps it sent
--   timeclock_raw       every punch line the clock sends, as sent; turned into time_punches once the clock is turned on
--   timeclock_cmds      things we ask the clock to do (add our employees by ID, list who's on it)
-- A new clock shows up as Off until an owner or admin turns it on (Time Clock → Settings → Wall Clocks).

alter table public.timeclock_devices add column if not exists kind text not null default 'tablet';
alter table public.timeclock_devices add column if not exists serial text;
alter table public.timeclock_devices add column if not exists info jsonb not null default '{}'::jsonb;
alter table public.timeclock_devices add column if not exists att_stamp text;
alter table public.timeclock_devices add column if not exists op_stamp text;
create unique index if not exists timeclock_devices_serial_key on public.timeclock_devices (serial) where serial is not null;

create table if not exists public.timeclock_raw (
  id bigserial primary key,
  device_id uuid references public.timeclock_devices(id) on delete cascade,
  serial text not null,
  kind text not null default 'att',
  line text not null,
  received_at timestamptz not null default now(),
  done boolean not null default false,
  punch_id uuid,
  note text not null default ''
);
create index if not exists timeclock_raw_pending_idx on public.timeclock_raw (device_id, done, received_at);
create unique index if not exists timeclock_raw_line_key on public.timeclock_raw (serial, kind, line);

create table if not exists public.timeclock_cmds (
  id bigserial primary key,
  device_id uuid not null references public.timeclock_devices(id) on delete cascade,
  cmd text not null,
  created_at timestamptz not null default now(),
  created_by text not null default '',
  sent_at timestamptz,
  done_at timestamptz,
  result text
);
create index if not exists timeclock_cmds_device_idx on public.timeclock_cmds (device_id, sent_at);

alter table public.timeclock_raw enable row level security;
alter table public.timeclock_cmds enable row level security;
drop policy if exists timeclock_raw_admins on public.timeclock_raw;
create policy timeclock_raw_admins on public.timeclock_raw for select using (public.staff_role() in ('owner', 'admin'));
drop policy if exists timeclock_cmds_admins on public.timeclock_cmds;
create policy timeclock_cmds_admins on public.timeclock_cmds for select using (public.staff_role() in ('owner', 'admin'));
