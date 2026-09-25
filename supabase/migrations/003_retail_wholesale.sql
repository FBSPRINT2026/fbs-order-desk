-- Retail vs wholesale pricing
alter table public.customers
  add column if not exists price_type text not null default 'retail' check (price_type in ('retail','wholesale'));
alter table public.orders
  add column if not exists price_type text not null default 'retail' check (price_type in ('retail','wholesale'));
