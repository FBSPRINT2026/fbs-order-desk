-- Goods issues (Nov 2, Nick): a problem with a customer's goods, shown at the top of Goods for the shop and the customer.
--  · from check-in: short, over, wrong item (mispick), damaged, a missing box; one issue per check-in, with the items
--    still owed (a small order of its own: when the replacement comes on a later supplier list, it goes here first);
--  · from tracking: a label made but no scan 12 hours later, no movement in 3 business days, delayed, an exception,
--    return to sender, damaged or undeliverable.
-- Who works it (owner): the customer (their own S&S account, their own vendor) or the shop (our SanMar / blank orders).
-- Status: open → reported → replacing → closed. Never deleted: closed_at closes one.
create table if not exists public.goods_issues (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  archived_order_id uuid,
  customer_id uuid references public.customers(id) on delete set null,
  checkin_id uuid,
  kind text not null default 'short',           -- short | over | mispick | damaged | missing | tracking
  source text not null default 'checkin',       -- checkin | tracking | staff | customer
  owner text not null default 'customer',       -- customer | shop
  supplier text not null default '',            -- ss | sanmar | other
  supplier_order text not null default '',
  po text not null default '',
  items jsonb not null default '[]'::jsonb,     -- [{ style, color, size, expected, received, owed, bad, issue, note }]
  tracking text not null default '',
  title text not null default '',
  detail text not null default '',
  photos jsonb not null default '[]'::jsonb,    -- storage paths in proofs
  status text not null default 'open',          -- open | reported | replacing | closed
  reported_at timestamptz,
  reported_by text not null default '',
  closed_at timestamptz,
  closed_by text not null default '',
  closed_how text not null default '',
  dedupe_key text unique,
  alerted_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists goods_issues_open on public.goods_issues(customer_id) where closed_at is null;
create index if not exists goods_issues_order on public.goods_issues(order_id);
alter table public.goods_issues enable row level security;
drop policy if exists goods_issues_staff on public.goods_issues;
create policy goods_issues_staff on public.goods_issues for all using (public.is_staff()) with check (public.is_staff());

-- the supplier reps an issue's email goes to: ours (customer_id null) and each customer's, remembered when used
create table if not exists public.goods_reps (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  supplier text not null,
  email text not null default '',
  name text not null default '',
  updated_at timestamptz not null default now()
);
create unique index if not exists goods_reps_one on public.goods_reps(coalesce(customer_id, '00000000-0000-0000-0000-000000000000'::uuid), supplier);
alter table public.goods_reps enable row level security;
drop policy if exists goods_reps_staff on public.goods_reps;
create policy goods_reps_staff on public.goods_reps for all using (public.is_staff()) with check (public.is_staff());
