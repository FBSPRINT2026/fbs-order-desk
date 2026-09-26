-- Discount can be a percent or a dollar amount
alter table public.orders add column if not exists discount_amt numeric not null default 0;
alter table public.orders add column if not exists discount_type text not null default 'pct' check (discount_type in ('pct','amt'));
