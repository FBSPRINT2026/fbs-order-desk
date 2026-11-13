-- Payday: each person checks their own hours for the pay period on their phone (Nick, Nov 13 2026: "before when we used
-- uAttend… we would print off the time card sheets… I want it to be digital… they approve it or they request a change").
-- One row per person per pay period: approved (with the hours they saw), or a fix asked (time_fix_requests holds it).
-- A fix approved later puts the row back to waiting, so they look again and approve the corrected hours.
create table if not exists public.time_card_checks (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('approved', 'fix_asked')),
  hours numeric not null default 0,
  note text not null default '',
  decided_at timestamptz not null default now(),
  unique (employee_id, period_start)
);
create index if not exists time_card_checks_period on public.time_card_checks (period_start);
alter table public.time_card_checks enable row level security;
drop policy if exists time_card_checks_staff on public.time_card_checks;
create policy time_card_checks_staff on public.time_card_checks for all using ((select public.is_staff())) with check ((select public.is_staff()));
