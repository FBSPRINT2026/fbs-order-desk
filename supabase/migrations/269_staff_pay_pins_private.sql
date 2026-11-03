-- The PINs live in their own table nobody can read from the browser (row security on, no policies, no grants): only the
-- server checks them (app/shop/take-payment-actions.ts). The staff columns from 268 aren't used.
create table if not exists public.staff_pay_pins (email text primary key, hash text not null, fails integer not null default 0, locked_until timestamptz, set_at timestamptz not null default now(), set_by text);
alter table public.staff_pay_pins enable row level security;
revoke all on public.staff_pay_pins from anon, authenticated;
