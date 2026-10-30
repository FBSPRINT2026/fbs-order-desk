-- Create order training kept staff-only (Oct 30, 2026): on customer_private, not customers. customers.order_training (245) is left unused.
alter table public.customer_private add column if not exists order_training text not null default '';
