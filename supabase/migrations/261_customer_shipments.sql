-- Goods a customer tells us are coming before there's an order for them (Nov 2, Nick: "a lot of times they're gonna be
-- sending us goods before we know about it"): "Send us goods" on their Goods tab with no order picked saves here, one row
-- per tracking number, with the job in their words. It's tracked like our blanks and waits at the top of "Shipments not
-- linked"; when they (or we) put it on an order, its rows become that order's goods shipments and linked_order_id is set.
-- Never deleted: archived_at hides one.
create table if not exists public.customer_shipments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  job_text text not null default '',
  vendor text not null default '',
  vendor_order text not null default '',
  carrier text not null default '',
  tracking text not null default '',
  boxes integer,
  note text not null default '',
  files jsonb not null default '[]'::jsonb,
  author_name text not null default '',
  tracker_id text,
  track_status text,
  track_detail text,
  est_delivery timestamptz,
  delivered_at timestamptz,
  track_updated_at timestamptz,
  linked_order_id uuid references public.orders(id) on delete set null,
  linked_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists customer_shipments_open on public.customer_shipments(customer_id) where linked_order_id is null and archived_at is null;
alter table public.customer_shipments enable row level security;
drop policy if exists customer_shipments_staff on public.customer_shipments;
create policy customer_shipments_staff on public.customer_shipments for all using (public.is_staff()) with check (public.is_staff());
