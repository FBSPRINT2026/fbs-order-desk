-- Printavo archive: old Printavo invoices and quotes, kept exactly as they were (read-only), next to the new orders.
-- They live in their own table so they never mix with new-style orders (numbers, pricing, board, statuses).

-- which of our customers each Printavo customer became (staff only: holds Printavo's internal notes)
create table if not exists public.printavo_customers (
  printavo_id text primary key,
  customer_id uuid not null references public.customers(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now()
);
create index if not exists printavo_customers_customer_idx on public.printavo_customers (customer_id);
alter table public.printavo_customers enable row level security;
drop policy if exists printavo_customers_staff on public.printavo_customers;
create policy printavo_customers_staff on public.printavo_customers for all using (public.is_staff()) with check (public.is_staff());

create table if not exists public.archived_orders (
  id uuid primary key default gen_random_uuid(),
  printavo_id text not null unique,
  kind text not null default 'invoice' check (kind in ('invoice','quote')),
  visual_id text not null default '',
  customer_id uuid not null references public.customers(id) on delete cascade,
  nickname text not null default '',
  status_name text not null default '',
  status_color text not null default '',
  order_date date,
  due_date date,
  total numeric not null default 0,
  paid numeric not null default 0,
  balance numeric not null default 0,
  qty integer not null default 0,
  po_number text not null default '',
  -- the whole Printavo record: line items with sizes, imprints, mockups, fees, payments, notes, files, tasks, messages
  data jsonb not null default '{}'::jsonb,
  -- copies of the artwork in our storage: original Printavo file URL -> path in the proofs bucket
  files jsonb not null default '{}'::jsonb,
  files_total integer not null default 0,
  files_copied integer not null default 0,
  imported_at timestamptz not null default now()
);
create index if not exists archived_orders_customer_idx on public.archived_orders (customer_id, order_date desc);
create index if not exists archived_orders_visual_idx on public.archived_orders (visual_id);
alter table public.archived_orders enable row level security;
drop policy if exists archived_orders_staff on public.archived_orders;
create policy archived_orders_staff on public.archived_orders for all using (public.is_staff()) with check (public.is_staff());
