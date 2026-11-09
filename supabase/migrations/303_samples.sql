-- Samples (Nov 9, Nick): a sample order is priced by a sample rule (the customer's, else the shop's), not the price list
alter table public.customers add column if not exists sample_rule jsonb;
alter table public.orders add column if not exists sample jsonb;
alter table public.orders drop constraint if exists orders_order_type_check;
alter table public.orders add constraint orders_order_type_check check (order_type = any (array['new','reorder','reorder_changes','sample']));
