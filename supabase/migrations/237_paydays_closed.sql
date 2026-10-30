-- A payday closed out in the Payroll Center (Oct 30, Nick: "we need something in the system payroll center that says
-- payroll finished and we'll just close it out"): who closed it, when, and what it paid. Closing locks the payday's
-- bonus and advance boxes. Reopening clears closed_at (nothing is deleted). Written through the server action only.
create table if not exists paydays (
  period_start date primary key,
  pay_date date not null,
  closed_at timestamptz,
  closed_by text not null default '',
  w2_count int not null default 0,
  checks int not null default 0,
  checks_total numeric(12,2) not null default 0,
  advances_total numeric(12,2) not null default 0,
  note text not null default '',
  updated_at timestamptz not null default now()
);
alter table paydays enable row level security;
create policy "payroll managers read paydays" on paydays for select using (
  exists (select 1 from staff s where lower(s.email) = lower(auth.jwt()->>'email') and (s.role in ('owner','admin') or coalesce(s.sees_pay,false)))
);
