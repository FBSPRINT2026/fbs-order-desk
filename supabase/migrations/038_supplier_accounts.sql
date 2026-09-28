-- Supplier account names that don't match our customer names ("GUNPOWDER & WHISKEY", SanMar account 254874 → Cowboy Cool).
-- Staff answer "who is this?" once; every later manifest line from that account goes to that customer.
create table if not exists public.supplier_accounts (
  id uuid primary key default gen_random_uuid(),
  supplier text not null,                 -- 'ss' | 'sanmar'
  account text not null default '',       -- the supplier's account number when the manifest has one (SanMar does)
  name_key text not null default '',      -- company_key of the name on the manifest (S&S has names only)
  name text not null default '',          -- as written on the manifest
  customer_id uuid not null references public.customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (supplier, account, name_key)
);
alter table public.supplier_accounts enable row level security;
drop policy if exists supplier_accounts_staff on public.supplier_accounts;
create policy supplier_accounts_staff on public.supplier_accounts for all using (public.is_staff()) with check (public.is_staff());

-- SanMar lines: account number, carton ids (text), weight
alter table public.supplier_manifest_lines add column if not exists customer_account text not null default '';
alter table public.supplier_manifest_lines add column if not exists weight numeric;
alter table public.supplier_manifest_lines drop constraint if exists supplier_manifest_lines_supplier_supplier_order_sku_box_tracking_key;
alter table public.supplier_manifest_lines alter column box type text using coalesce(box::text, '');
alter table public.supplier_manifest_lines alter column box set default '';
update public.supplier_manifest_lines set box = '' where box is null;
alter table public.supplier_manifest_lines alter column box set not null;
alter table public.supplier_manifest_lines add constraint sml_dedupe unique (supplier, supplier_order, sku, box, tracking, style, color, size);

-- "The McKenna Group, LLC" and "MCKENNAGROUP LLC THE" are the same company: drop a trailing "the" too
create or replace function public.company_key(name text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    replace(lower(coalesce(name, '')), '&', ' and '),
    '[^a-z0-9]+', ' ', 'g'),
    '\m(inc|llc|ltd|co|corp|corporation|company|pllc|pc)\M', ' ', 'g'),
    '^\s*the', ''),
    '\mthe\s*$', ''),
    '\s+', '', 'g')
$$;
update public.customers set company = company;  -- recompute the stored company_key
