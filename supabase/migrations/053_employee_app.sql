-- Employee app (/work): employee number + PIN on their own phone, English / Spanish
create sequence if not exists public.employee_code_seq start 101;
alter table public.employees add column if not exists code integer unique default nextval('public.employee_code_seq');
update public.employees set code = nextval('public.employee_code_seq') where code is null;
alter table public.employees add column if not exists lang text not null default 'en';
alter table public.employee_pins add column if not exists fails integer not null default 0;
alter table public.employee_pins add column if not exists locked_until timestamptz;
create table if not exists public.employee_sessions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  expires_at timestamptz not null,
  revoked boolean not null default false
);
alter table public.employee_sessions enable row level security;
drop policy if exists employee_sessions_admins on public.employee_sessions;
create policy employee_sessions_admins on public.employee_sessions for select using (public.staff_role() in ('owner', 'admin'));
