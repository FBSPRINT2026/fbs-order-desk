-- Goods panel on the order (Oct 29, Nick): tracking for goods we bought (any vendor, typed, pasted or from the supplier),
-- kept on our own goods order (customer supplied tracking stays in goods_shipments, which the customer's portal shows)
alter table blank_orders add column if not exists tracking jsonb not null default '[]'::jsonb;
