-- Garment photos per color (from S&S) and saved mockups
alter table public.garments add column if not exists color_images jsonb not null default '{}'::jsonb;
create table if not exists public.mockups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  proof_id uuid,
  title text not null default '',
  file_path text not null,
  design_ids uuid[] not null default '{}',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists mockups_customer_idx on public.mockups (customer_id);
create index if not exists mockups_order_idx on public.mockups (order_id);
alter table public.mockups enable row level security;
drop policy if exists mockups_staff on public.mockups;
create policy mockups_staff on public.mockups for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists mockups_customer_read on public.mockups;
create policy mockups_customer_read on public.mockups for select using (customer_id in (select public.my_customer_ids()));
