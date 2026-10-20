-- Time clock managers (Nick, Oct 20, 2026): Jose Moreno runs the time clock with Nick. Anyone with "Can see employee
-- pay rates" (staff.sees_pay) can now also change pay, not just see it ("Everything, including pay"). Owners and
-- admins keep everything they had. Additive only.
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'employee_pay' and policyname = 'employee_pay_managers_ins') then
    create policy employee_pay_managers_ins on public.employee_pay for insert with check (public.sees_pay());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'employee_pay' and policyname = 'employee_pay_managers_upd') then
    create policy employee_pay_managers_upd on public.employee_pay for update using (public.sees_pay()) with check (public.sees_pay());
  end if;
end $$;

-- How each person is paid, for the pay period report: QuickBooks payroll (W-2) or contract labor (1099).
alter table public.employees add column if not exists paid_by text not null default 'payroll';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'employees_paid_by_check') then
    alter table public.employees add constraint employees_paid_by_check check (paid_by in ('payroll', 'contract'));
  end if;
end $$;
