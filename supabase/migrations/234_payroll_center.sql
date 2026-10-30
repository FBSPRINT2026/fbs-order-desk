-- Payroll Center (Oct 30, 2026, Nick): one place for payday. W-2 hours for QuickBooks Payroll, a Print-later check in
-- QuickBooks for every contractor, and paycheck advances that come out of each check until they're paid off.
-- Additive only. Same access as employee_pay: owners / admins, and anyone who runs the time clock (staff.sees_pay).

-- someone the Payroll Center leaves out (the owner, a family member who isn't paid by check)
alter table public.employees add column if not exists payday_skip boolean not null default false;
-- the contractor's payee in QuickBooks (picked once, remembered): "Jose Garcia" = "Jose Isidro Garcia Gamez"
alter table public.employees add column if not exists qbo_vendor_id text;
alter table public.employees add column if not exists qbo_vendor_name text;

-- a paycheck advance: given once, paid back out of the following checks
create table if not exists public.pay_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  amount numeric(10,2) not null check (amount > 0),
  given_on date not null default current_date,
  per_check numeric(10,2),          -- "$250 a check"
  checks int,                       -- or "over 2 checks" (amount ÷ checks)
  note text not null default '',
  qbo_purchase_id text,             -- the advance check, when the Payroll Center wrote it
  created_by text,
  created_at timestamptz not null default now(),
  closed_at timestamptz             -- paid off (or written off by hand)
);
create index if not exists pay_advances_emp on public.pay_advances(employee_id);

-- what came out of one payday's check toward an advance
create table if not exists public.pay_advance_payments (
  id uuid primary key default gen_random_uuid(),
  advance_id uuid not null references public.pay_advances(id),
  period_start date not null,
  amount numeric(10,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (advance_id, period_start)
);

-- one person on one payday: the bonus typed in, the advance taken (when changed from the plan), and the check made
create table if not exists public.payday_lines (
  period_start date not null,
  employee_id uuid not null references public.employees(id),
  bonus numeric(10,2),
  advance_amount numeric(10,2),     -- null = the plan's amount
  qbo_purchase_id text,             -- the contractor's check in QuickBooks
  check_total numeric(10,2),
  check_made_at timestamptz,
  check_made_by text,
  done_at timestamptz,              -- W-2: entered in QuickBooks Payroll
  updated_at timestamptz not null default now(),
  primary key (period_start, employee_id)
);

alter table public.pay_advances enable row level security;
alter table public.pay_advance_payments enable row level security;
alter table public.payday_lines enable row level security;
do $$
declare t text;
begin
  foreach t in array array['pay_advances', 'pay_advance_payments', 'payday_lines'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_pay') then
      execute format('create policy %I on public.%I for all using (public.staff_role() in (''owner'', ''admin'') or public.sees_pay()) with check (public.staff_role() in (''owner'', ''admin'') or public.sees_pay())', t || '_pay', t);
    end if;
  end loop;
end $$;

-- the payee's kind in QuickBooks: a contractor is a Vendor; a W-2 person's advance check goes to their Employee record
alter table public.employees add column if not exists qbo_payee_type text;
