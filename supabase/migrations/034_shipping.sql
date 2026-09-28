-- Shipping center: one shipment per order sent out (boxes with size, weight and tracking), for new orders and
-- Printavo orders alike. Labels (EasyPost) come next; for now boxes, rates and tracking are recorded here.
create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  archived_order_id uuid references public.archived_orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','labeled','shipped','void')),
  ship_to jsonb not null default '{}'::jsonb,        -- name, company, street1, street2, city, state, zip, country, phone, email
  bill_to text not null default 'fbs' check (bill_to in ('fbs','ups','fedex')),   -- whose carrier account pays
  bill_account text not null default '',
  bill_zip text not null default '',
  carrier text not null default '',
  service text not null default '',
  boxes jsonb not null default '[]'::jsonb,          -- [{ n, length, width, height, weight, tracking, label_url }]
  rates jsonb,                                       -- last rates shown (carrier, service, cost, price, days)
  cost numeric,                                      -- what we paid (our account)
  price numeric,                                     -- what the customer is charged
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  shipped_at timestamptz,
  check (order_id is not null or archived_order_id is not null)
);
create index if not exists shipments_order_idx on public.shipments (order_id);
create index if not exists shipments_archived_idx on public.shipments (archived_order_id);
create index if not exists shipments_customer_idx on public.shipments (customer_id, created_at desc);
alter table public.shipments enable row level security;
drop policy if exists shipments_staff on public.shipments;
create policy shipments_staff on public.shipments for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists shipments_mine on public.shipments;
create policy shipments_mine on public.shipments for select using (customer_id in (select public.my_customer_ids()) and status in ('labeled','shipped'));

-- how each customer ships: on our account, or billed to their own UPS / FedEx account
alter table public.customers add column if not exists ship_bill text not null default 'fbs';
alter table public.customers add column if not exists ship_ups_account text not null default '';
alter table public.customers add column if not exists ship_fedex_account text not null default '';
alter table public.customers add column if not exists ship_bill_zip text not null default '';
