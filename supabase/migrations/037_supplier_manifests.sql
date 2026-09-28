-- Supplier manifests (S&S Activewear, SanMar): the daily list of what's shipping to us, box by box.
-- Lines are matched to orders: customers' own purchases → their wholesale order's customer supplied goods;
-- "FBS" lines are blanks we bought for our own (retail) orders.
create table if not exists public.supplier_manifest_lines (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,                 -- 'ss' | 'sanmar'
  file_name text not null default '',
  ship_date date,
  customer_name text not null default '',
  customer_po text not null default '',
  invoice text not null default '',
  box integer,
  warehouse text not null default '',
  method text not null default '',
  tracking text not null default '',
  sku text not null default '',
  mill text not null default '',
  style text not null default '',
  color text not null default '',
  size text not null default '',
  qty_ordered integer not null default 0,
  qty_shipped integer not null default 0,
  supplier_order text not null default '',
  order_id uuid references public.orders(id) on delete set null,
  kind text not null default '' check (kind in ('', 'goods', 'blanks', 'ignored')),  -- '' = not matched yet
  match_how text not null default '',
  created_at timestamptz not null default now(),
  unique (supplier, supplier_order, sku, box, tracking)
);
create index if not exists sml_order_idx on public.supplier_manifest_lines (order_id);
create index if not exists sml_open_idx on public.supplier_manifest_lines (kind, created_at desc);
alter table public.supplier_manifest_lines enable row level security;
drop policy if exists sml_staff on public.supplier_manifest_lines;
create policy sml_staff on public.supplier_manifest_lines for all using (public.is_staff()) with check (public.is_staff());
