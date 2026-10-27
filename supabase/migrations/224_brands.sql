-- Brands under a customer (Oct 27, Nick: Cedar Promos is a distributor "managing the production for another company":
-- MEI, ShipStation / WWEX, Embark each have their own brand standards). A brand holds its colors, its colorway rule
-- (which version of a logo goes on light / dark / one-color jobs) and its embroidery standard (threads, backing).
-- Logos (designs) belong to a brand. Additive only.
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null,
  colors jsonb not null default '[]'::jsonb,      -- [{ name, pms, hex }]
  rules jsonb not null default '{}'::jsonb,       -- { light, dark, one_light, one_dark } → colorway names
  embroidery jsonb not null default '{}'::jsonb,  -- { light: [thread names], dark: [thread names], backing }
  notes text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists brands_customer on public.brands(customer_id);
alter table public.brands enable row level security;
drop policy if exists brands_staff on public.brands;
create policy brands_staff on public.brands for all using ((select is_staff())) with check ((select is_staff()));
drop policy if exists brands_customer_read on public.brands;
create policy brands_customer_read on public.brands for select using (customer_id in (select my_customer_ids()));
alter table public.designs add column if not exists brand_id uuid references public.brands(id) on delete set null;
create index if not exists designs_brand on public.designs(brand_id);
