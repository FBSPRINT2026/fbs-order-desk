-- What the W-2 payroll actually cost, read back from QuickBooks after it's submitted (Oct 30, Nick: "it imports the actual
-- check amounts… employee taxes, matching… W-2 employees was this amount, plus FBS taxes equals total payroll").
alter table paydays add column if not exists w2_paychecks int;
alter table paydays add column if not exists w2_gross numeric(12,2);
alter table paydays add column if not exists w2_employee_taxes numeric(12,2);
alter table paydays add column if not exists w2_deductions numeric(12,2);
alter table paydays add column if not exists w2_net numeric(12,2);
alter table paydays add column if not exists w2_employer_taxes numeric(12,2);
alter table paydays add column if not exists qbo_pulled_at timestamptz;
