-- Goods bought ahead from an email, before there's an order (Oct 26, Nick): what was bought, one entry per garment and
-- color with its sizes [{brand, style, color, sizes: {S: 2, M: 4}}], so Create order can use them later without asking again.
alter table public.blank_orders add column if not exists garments jsonb not null default '[]'::jsonb;
create index if not exists blank_orders_unlinked on public.blank_orders (activity_id, customer_id) where order_id is null;
