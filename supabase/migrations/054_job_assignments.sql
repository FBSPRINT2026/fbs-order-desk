-- The day's plan: which jobs each person works on, in order (the production manager sets it; the employee app shows it)
create table if not exists public.job_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  day date not null,
  order_id uuid references public.orders(id) on delete cascade,
  archived_order_id uuid references public.archived_orders(id) on delete cascade,
  job_label text not null default '',
  position integer not null default 0,
  note text not null default '',
  station text not null default '',
  done_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists job_assignments_day_idx on public.job_assignments (day, employee_id, position);
alter table public.job_assignments enable row level security;
drop policy if exists job_assignments_staff on public.job_assignments;
create policy job_assignments_staff on public.job_assignments for all using (public.is_staff()) with check (public.is_staff());
