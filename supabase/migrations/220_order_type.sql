-- New order / Reorder / Reorder with changes on the order (Oct 24, Nick). Null = worked out from the order.
alter table orders add column if not exists order_type text check (order_type in ('new','reorder','reorder_changes'));
comment on column orders.order_type is 'New order / Reorder / Reorder with changes (Oct 24, Nick). Null = worked out from the order (a reorder label or prints waiting on production).';
