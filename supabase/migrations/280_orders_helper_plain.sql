-- "Just do what I say" for the AI order helper (Nov 3, Nick: "if we don't select Create New Order, Create Reorder, and we go
-- to that other space below, that's your indicator to just be a helper… don't have any rules or anything like that"). On
-- for an order made from Create order → Other options, and switchable on any order from the helper.
alter table public.orders add column if not exists helper_plain boolean not null default false;
