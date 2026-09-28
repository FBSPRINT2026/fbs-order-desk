-- Customer supplied goods: where the goods come from (SanMar, S&S…) and live tracking on every inbound package.
alter table public.order_goods add column if not exists supplier text not null default '';      -- 'sanmar' | 'ss' | any other name
alter table public.order_goods add column if not exists supplier_po text not null default '';   -- their order / PO number with the supplier
alter table public.order_goods add column if not exists ship_date date;                          -- when the supplier ships (what they told us)
alter table public.order_goods add column if not exists alerted jsonb not null default '{}'::jsonb; -- which alerts already went out (so each goes once)

alter table public.goods_shipments add column if not exists source text not null default '';           -- '' (typed in) | 'manifest'
alter table public.goods_shipments add column if not exists tracker_id text not null default '';       -- EasyPost tracker
alter table public.goods_shipments add column if not exists track_status text not null default '';     -- pre_transit, in_transit, out_for_delivery, delivered, exception, …
alter table public.goods_shipments add column if not exists track_detail text not null default '';     -- latest scan, in words
alter table public.goods_shipments add column if not exists est_delivery timestamptz;
alter table public.goods_shipments add column if not exists delivered_at timestamptz;
alter table public.goods_shipments add column if not exists track_updated_at timestamptz;
create index if not exists goods_shipments_tracker_idx on public.goods_shipments (tracker_id);
