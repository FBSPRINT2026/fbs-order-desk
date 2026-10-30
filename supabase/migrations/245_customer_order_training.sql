-- Create order training per customer (Oct 30, 2026): how a big client's orders are made, read in full by the order reader.
alter table public.customers add column if not exists order_training text not null default '';
