-- Time clock & attendance: our own replacement for uAttend.
--   employees        everyone who clocks in (a shop staff login is optional: staff_email links them)
--   employee_pay     pay rate / salary, owner and admins only
--   time_punches     every punch (in, out, break start/end); edits keep the original time and who changed it; never deleted, voided instead
--   shifts           the schedule
--   time_off         PTO / sick / holiday / unpaid, requested and approved
--   timeclock_devices  tablets set up as wall clocks (a secret token in the tablet's browser; PIN tries are limited per device)
--   time_periods     a pay period's approval
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  first_name text not null default '',
  last_name text not null default '',
  email text not null default '',
  phone text not null default '',
  staff_email text,
  department text not null default '',
  title text not null default '',
  pay_type text not null default 'hourly' check (pay_type in ('hourly', 'salary')),
  color text not null default '',
  has_pin boolean not null default false,
  active boolean not null default true,
  hire_date date,
  end_date date,
  uattend_id text unique,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists employees_active_idx on public.employees (active, last_name);

create table if not exists public.employee_pay (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  rate numeric,
  salary numeric,
  updated_at timestamptz not null default now()
);

create table if not exists public.time_punches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  kind text not null check (kind in ('in', 'out', 'break_start', 'break_end')),
  at timestamptz not null,
  source text not null default 'kiosk',
  device_id uuid,
  photo_path text,
  lat double precision,
  lng double precision,
  accuracy double precision,
  note text not null default '',
  original_at timestamptz,
  edited_by text,
  edited_at timestamptz,
  voided boolean not null default false,
  uattend_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists time_punches_emp_at_idx on public.time_punches (employee_id, at);
create index if not exists time_punches_at_idx on public.time_punches (at);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  station text not null default '',
  note text not null default '',
  published boolean not null default true,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists shifts_starts_idx on public.shifts (starts_at);

create table if not exists public.time_off (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  hours numeric not null default 8,
  kind text not null default 'pto' check (kind in ('pto', 'sick', 'holiday', 'unpaid')),
  status text not null default 'approved' check (status in ('requested', 'approved', 'denied')),
  note text not null default '',
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.timeclock_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Time clock',
  token_hash text not null unique,
  active boolean not null default true,
  fails integer not null default 0,
  locked_until timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.time_periods (
  starts_on date primary key,
  ends_on date not null,
  approved_at timestamptz,
  approved_by text
);

alter table public.employees enable row level security;
alter table public.employee_pay enable row level security;
alter table public.time_punches enable row level security;
alter table public.shifts enable row level security;
alter table public.time_off enable row level security;
alter table public.timeclock_devices enable row level security;
alter table public.time_periods enable row level security;

drop policy if exists employees_staff on public.employees;
create policy employees_staff on public.employees for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists employee_pay_admins on public.employee_pay;
create policy employee_pay_admins on public.employee_pay for all using (public.staff_role() in ('owner', 'admin')) with check (public.staff_role() in ('owner', 'admin'));
drop policy if exists time_punches_staff on public.time_punches;
create policy time_punches_staff on public.time_punches for select using (public.is_staff());
drop policy if exists time_punches_staff_ins on public.time_punches;
create policy time_punches_staff_ins on public.time_punches for insert with check (public.is_staff());
drop policy if exists time_punches_staff_upd on public.time_punches;
create policy time_punches_staff_upd on public.time_punches for update using (public.is_staff()) with check (public.is_staff());
-- (no delete policy: punches are voided, never deleted)
drop policy if exists shifts_staff on public.shifts;
create policy shifts_staff on public.shifts for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists time_off_staff on public.time_off;
create policy time_off_staff on public.time_off for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists timeclock_devices_admins on public.timeclock_devices;
create policy timeclock_devices_admins on public.timeclock_devices for all using (public.staff_role() in ('owner', 'admin')) with check (public.staff_role() in ('owner', 'admin'));
drop policy if exists time_periods_staff on public.time_periods;
create policy time_periods_staff on public.time_periods for all using (public.is_staff()) with check (public.is_staff());

-- PIN hashes live apart and are only read on the server (no policy = no access from the browser)
create table if not exists public.employee_pins (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);
alter table public.employee_pins enable row level security;

-- punch photos (private)
insert into storage.buckets (id, name, public) values ('timeclock', 'timeclock', false) on conflict (id) do nothing;
