-- Goods & receiving: blanks we order for our own (retail) jobs, and every package coming in for them.
create table if not exists public.blank_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  supplier text not null default 'ss',          -- 'ss' | 'sanmar' | other name
  supplier_order text not null default '',      -- their order number(s)
  po text not null default '',
  status text not null default 'ordered' check (status in ('ordered','received','cancelled')),
  lines jsonb not null default '[]'::jsonb,     -- [{ style, color, size, qty, sku, price, warehouse }]
  total numeric,
  expected_date date,
  note text not null default '',
  placed_via text not null default 'manual',    -- 'api' (ordered from here) | 'manual' (ordered on the supplier's site)
  created_by text not null default '',
  created_at timestamptz not null default now(),
  received_at timestamptz
);
create index if not exists blank_orders_order_idx on public.blank_orders (order_id);
alter table public.blank_orders enable row level security;
drop policy if exists blank_orders_staff on public.blank_orders;
create policy blank_orders_staff on public.blank_orders for all using (public.is_staff()) with check (public.is_staff());

create table if not exists public.blank_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  blank_order_id uuid references public.blank_orders(id) on delete set null,
  supplier text not null default '',
  carrier text not null default '',
  tracking text not null default '',
  boxes integer,
  pcs integer,
  note text not null default '',
  eta date,
  source text not null default '',              -- 'manifest' | 'api' | ''
  tracker_id text not null default '',
  track_status text not null default '',
  track_detail text not null default '',
  est_delivery timestamptz,
  delivered_at timestamptz,
  track_updated_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists blank_shipments_order_idx on public.blank_shipments (order_id);
alter table public.blank_shipments enable row level security;
drop policy if exists blank_shipments_staff on public.blank_shipments;
create policy blank_shipments_staff on public.blank_shipments for all using (public.is_staff()) with check (public.is_staff());
-- (040) which alerts already went out for a blanks package
alter table public.blank_shipments add column if not exists alerted jsonb not null default '{}'::jsonb;
