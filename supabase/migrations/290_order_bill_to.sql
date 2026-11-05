alter table orders add column if not exists bill_to jsonb;
comment on column orders.bill_to is 'this order only: bill a department of the account {dept, attn, email, cc, address} (Nov 5)';
create index if not exists orders_bill_to_cust on orders (customer_id) where bill_to is not null;
