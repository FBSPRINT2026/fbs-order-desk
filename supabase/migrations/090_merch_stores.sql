-- Merch stores (Sales → Merch Stores): a pre-order store for one client (a school PTA, a team, a company). Parents and
-- members order and pay one by one; when the store closes we order the goods, print, and pack every order in its own bag
-- sorted for hand-out (teacher → student). Built for FBS staff and, for customers marked as merch-store clients, from
-- their portal (they set the give-back on top of FBS's price; FBS's price is the floor).
-- Shoppers never sign in: the public store and the order status page are served by the app with the admin client.

-- a customer who may build their own stores in the portal
alter table public.customers add column if not exists merch_client boolean not null default false;

create table if not exists public.merch_stores (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  name text not null,
  slug text not null unique,                    -- portal.fbsprint.com/s/<slug>
  -- draft → open → closed → ordered (goods) → production → packing → ready → delivered; archived
  status text not null default 'draft' check (status in ('draft','review','open','closed','ordered','production','packing','ready','delivered','archived')),
  opens_at timestamptz,
  closes_at timestamptz,
  deliver_by date,                              -- expected in-hands date shown to shoppers
  -- { school, mascot, district, city, logo, banner, primary, accent, text, tagline }
  brand jsonb not null default '{}'::jsonb,
  welcome text not null default '',
  -- { org: { on, label, address, note }, pickup: { on, note }, ship: { on, flat } }
  delivery jsonb not null default '{"org":{"on":true,"label":"","address":"","note":""},"pickup":{"on":false,"note":""},"ship":{"on":false,"flat":8}}'::jsonb,
  -- checkout questions: [{ key, label, kind: 'text' | 'select', options: [], required, sort }]
  fields jsonb not null default '[{"key":"student","label":"Student name","kind":"text","options":[],"required":true,"sort":2},{"key":"grade","label":"Grade","kind":"select","options":["K","1st","2nd","3rd","4th","5th","Staff"],"required":true,"sort":0},{"key":"teacher","label":"Homeroom teacher","kind":"select","options":[],"required":true,"sort":1}]'::jsonb,
  -- give-back: { goal, note } (the amount is set per product)
  giveback jsonb not null default '{}'::jsonb,
  tax_rate numeric not null default 8.25,
  tax_exempt boolean not null default false,
  -- the store's main contact (the PTA lead): { name, email, phone }
  contact jsonb not null default '{}'::jsonb,
  password text not null default '',            -- optional access code for the store page
  order_id uuid references public.orders(id) on delete set null,  -- the production job made at close
  goods_ordered_at timestamptz,
  -- [{ status, at, by, note }]
  timeline jsonb not null default '[]'::jsonb,
  owner text not null default 'staff' check (owner in ('staff','customer')),  -- who built it
  notes text not null default '',
  -- { expected: pieces per design (prices), notify: email shoppers at each step }
  settings jsonb not null default '{"expected":48,"notify":true}'::jsonb,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists merch_stores_customer on public.merch_stores (customer_id);
create index if not exists merch_stores_status on public.merch_stores (status, closes_at);

create table if not exists public.merch_products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.merch_stores(id) on delete cascade,
  position integer not null default 0,
  name text not null,
  description text not null default '',
  design_id uuid references public.designs(id) on delete set null,
  -- the imprint: { location, width, inks, method }
  imprint jsonb not null default '{}'::jsonb,
  supplier text not null default '',            -- 'ss' | 'sanmar' | ''
  style text not null default '',
  brand text not null default '',
  garment_id uuid references public.garments(id) on delete set null,
  -- [{ name, hex, image (mockup path), photo (blank photo), sizes: [..] }]
  colors jsonb not null default '[]'::jsonb,
  sizes text[] not null default '{}',
  cost jsonb not null default '{}'::jsonb,      -- blank cost per size (staff only)
  base_price numeric not null default 0,        -- FBS's price per piece (the floor)
  giveback numeric not null default 0,          -- added on top per piece; goes back to the organization
  upcharges jsonb not null default '{}'::jsonb, -- per size, e.g. { "2XL": 2, "3XL": 3 }
  personalize jsonb not null default '[]'::jsonb, -- [{ label, price, max }]
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists merch_products_store on public.merch_products (store_id, position);

create table if not exists public.merch_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.merch_stores(id) on delete cascade,
  number integer not null,                      -- 1, 2, 3… within the store
  token text not null unique,                   -- the shopper's status / change link
  shopper jsonb not null default '{}'::jsonb,   -- { name, email, phone }
  answers jsonb not null default '{}'::jsonb,   -- { student, grade, teacher, … }
  delivery text not null default 'org' check (delivery in ('org','pickup','ship')),
  ship_to jsonb not null default '{}'::jsonb,
  subtotal numeric not null default 0,
  tax numeric not null default 0,
  shipping numeric not null default 0,
  total numeric not null default 0,
  giveback numeric not null default 0,
  status text not null default 'paid' check (status in ('pending','paid','cancelled','refunded','packed','delivered','picked_up','shipped')),
  paid_at timestamptz,
  processor_id text not null default '',
  pay_method text not null default '',
  packed_at timestamptz,
  packed_by text not null default '',
  tracking text not null default '',
  -- [{ at, by, what }]: changes the shopper or staff made
  changes jsonb not null default '[]'::jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, number)
);
create index if not exists merch_orders_store on public.merch_orders (store_id, created_at);

create table if not exists public.merch_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.merch_orders(id) on delete cascade,
  product_id uuid references public.merch_products(id) on delete set null,
  name text not null default '',
  style text not null default '',
  color text not null default '',
  size text not null default '',
  qty integer not null default 1 check (qty > 0),
  unit_price numeric not null default 0,       -- what the shopper paid per piece
  base_price numeric not null default 0,       -- FBS's price per piece at the time
  giveback numeric not null default 0,         -- per piece
  personalization jsonb not null default '{}'::jsonb,
  -- '' (to pack) | 'packed' | 'backorder'
  pack text not null default '' check (pack in ('','packed','backorder')),
  created_at timestamptz not null default now()
);
create index if not exists merch_order_items_order on public.merch_order_items (order_id);
create index if not exists merch_order_items_product on public.merch_order_items (product_id);

-- the next order number in a store (no gaps between two shoppers checking out at the same moment)
create or replace function public.merch_next_number(p_store uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtext('merch:' || p_store::text));
  select coalesce(max(number), 0) + 1 into n from merch_orders where store_id = p_store;
  return n;
end $$;

alter table public.merch_stores enable row level security;
alter table public.merch_products enable row level security;
alter table public.merch_orders enable row level security;
alter table public.merch_order_items enable row level security;
create policy merch_stores_staff on public.merch_stores for all using (public.is_staff()) with check (public.is_staff());
create policy merch_products_staff on public.merch_products for all using (public.is_staff()) with check (public.is_staff());
create policy merch_orders_staff on public.merch_orders for all using (public.is_staff()) with check (public.is_staff());
create policy merch_order_items_staff on public.merch_order_items for all using (public.is_staff()) with check (public.is_staff());
