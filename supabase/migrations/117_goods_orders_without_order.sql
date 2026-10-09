-- Order goods (Shop Tools → Order goods): blanks bought from S&S before there's an order (from an email, or to stock up).
-- A goods order can now stand on its own and be linked to its order later.
alter table public.blank_orders alter column order_id drop not null;
alter table public.blank_orders add column if not exists customer_id uuid references public.customers(id) on delete set null;
alter table public.blank_orders add column if not exists activity_id uuid references public.activities(id) on delete set null;
alter table public.blank_orders add column if not exists label text not null default '';
create index if not exists blank_orders_activity_idx on public.blank_orders(activity_id) where activity_id is not null;
