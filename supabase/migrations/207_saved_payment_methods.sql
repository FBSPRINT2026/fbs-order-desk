-- Card / bank on file (Oct 24, Nick): only Stax's payment method id and what's on a receipt (brand, last 4, expiry) are
-- kept here; the numbers stay at Stax. Plus every online payment try, so a run of failures locks the pay form a while.
create table if not exists saved_payment_methods (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  stax_pm_id text not null,
  method text not null default 'card',
  brand text not null default '',
  last4 text not null default '',
  exp text not null default '',
  holder text not null default '',
  consent_text text not null default '',
  consented_by text not null default '',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  removed_at timestamptz,
  removed_by text
);
create index if not exists saved_pm_customer_idx on saved_payment_methods (customer_id) where removed_at is null;
alter table saved_payment_methods enable row level security;
drop policy if exists saved_pm_customer_read on saved_payment_methods;
create policy saved_pm_customer_read on saved_payment_methods for select using (customer_id in (select my_customer_ids()));
drop policy if exists saved_pm_staff on saved_payment_methods;
create policy saved_pm_staff on saved_payment_methods for all using ((select is_staff()));

create table if not exists pay_attempts (
  id bigserial primary key,
  customer_id uuid,
  email text not null default '',
  ok boolean not null default false,
  amount numeric not null default 0,
  error text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists pay_attempts_recent_idx on pay_attempts (email, created_at desc);
alter table pay_attempts enable row level security;
drop policy if exists pay_attempts_staff on pay_attempts;
create policy pay_attempts_staff on pay_attempts for all using ((select is_staff()));
