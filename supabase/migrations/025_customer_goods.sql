-- Customer supplied goods (wholesale): the garments a customer sends us for a job.
-- The goods have their own status, separate from the job's status.
create table if not exists public.order_goods (
  order_id uuid primary key references public.orders(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','on_way','arrived','partial','received','issue')),
  issue_type text not null default '' check (issue_type in ('','short','over','mispick','damaged','missing','other')),
  issue_note text not null default '',
  -- what the customer told us is coming (brand/style/colors/quantities, where from)
  expected text not null default '',
  updated_by text not null default '',
  updated_at timestamptz not null default now()
);
alter table public.order_goods enable row level security;
drop policy if exists order_goods_staff on public.order_goods;
create policy order_goods_staff on public.order_goods for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists order_goods_customer on public.order_goods;
create policy order_goods_customer on public.order_goods for select using (order_id in (select public.my_order_ids()));

-- shipments on the way: tracking numbers, boxes, expected date, packing slips and photos
create table if not exists public.goods_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  carrier text not null default '',
  tracking text not null default '',
  boxes integer,
  eta date,
  note text not null default '',
  files jsonb not null default '[]'::jsonb,
  added_by text not null default 'customer' check (added_by in ('customer','staff')),
  author_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists goods_shipments_order_idx on public.goods_shipments (order_id, created_at);
alter table public.goods_shipments enable row level security;
drop policy if exists goods_shipments_staff on public.goods_shipments;
create policy goods_shipments_staff on public.goods_shipments for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists goods_shipments_customer on public.goods_shipments;
create policy goods_shipments_customer on public.goods_shipments for select using (order_id in (select public.my_order_ids()));

-- messages can be about the goods on an order (their own conversation)
alter table public.messages add column if not exists topic text not null default '';
