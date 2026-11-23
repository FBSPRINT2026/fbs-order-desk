-- Purchase orders we send a vendor for an order's items (Nick, Nov 23 2026: "under the documents, create a purchase
-- order… quantity, a picture, item, description… and then the shipping information… typically to us"; no pricing).
-- One order can have several: PO <order #>-<seq>.
create table if not exists purchase_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  seq int not null,
  vendor text not null default '',
  vendor_contact text not null default '',
  ship_to_kind text not null default 'us',
  ship_to text not null default '',
  needed_by date,
  notes text not null default '',
  line_ids text[] not null default '{}',
  qty jsonb not null default '{}'::jsonb,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, seq)
);
create index if not exists purchase_orders_vendor on purchase_orders (lower(vendor));
alter table purchase_orders enable row level security;
