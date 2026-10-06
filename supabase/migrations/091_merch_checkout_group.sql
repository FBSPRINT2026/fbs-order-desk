-- One checkout can hold orders for several students (siblings): one payment, one bag (order) per student.
alter table merch_orders add column if not exists checkout_id uuid;
create index if not exists merch_orders_checkout_idx on merch_orders (checkout_id) where checkout_id is not null;
create index if not exists merch_orders_store_email_idx on merch_orders (store_id, lower(shopper->>'email'));
