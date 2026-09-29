-- Job time: people (or a team) punch onto an order when they start it and off when they finish, per task
-- (setup, printing, folding…), so we know real labor hours, cost and pieces per hour on every job.
create table if not exists public.job_time (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  archived_order_id uuid references public.archived_orders(id) on delete set null,
  job_label text not null default '',
  task text not null default '',
  station text not null default '',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  pieces integer,
  note text not null default '',
  source text not null default 'clock',
  team_id uuid,
  started_by uuid,
  auto_stopped boolean not null default false,
  voided boolean not null default false,
  edited_by text,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists job_time_order_idx on public.job_time (order_id);
create index if not exists job_time_arch_idx on public.job_time (archived_order_id);
create index if not exists job_time_emp_idx on public.job_time (employee_id, started_at);
create index if not exists job_time_open_idx on public.job_time (employee_id) where ended_at is null;
alter table public.job_time enable row level security;
drop policy if exists job_time_staff_sel on public.job_time;
create policy job_time_staff_sel on public.job_time for select using (public.is_staff());
drop policy if exists job_time_staff_ins on public.job_time;
create policy job_time_staff_ins on public.job_time for insert with check (public.is_staff());
drop policy if exists job_time_staff_upd on public.job_time;
create policy job_time_staff_upd on public.job_time for update using (public.is_staff()) with check (public.is_staff());
-- (no delete: entries are voided)
