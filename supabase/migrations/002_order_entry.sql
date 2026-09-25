-- Order entry upgrade: line item groups, job details, garment catalog, art files

alter table public.orders
  add column if not exists groups jsonb not null default '[]'::jsonb,
  add column if not exists po_number text not null default '',
  add column if not exists production_date date,
  add column if not exists rush boolean not null default false,
  add column if not exists delivery_method text not null default 'pickup'
    check (delivery_method in ('pickup','ship','deliver')),
  add column if not exists ship_to text not null default '',
  add column if not exists ship_method text not null default '',
  add column if not exists tracking text not null default '';

alter table public.customers
  add column if not exists contact2_name text not null default '',
  add column if not exists contact2_email text not null default '',
  add column if not exists contact2_phone text not null default '',
  add column if not exists ship_address text not null default '';

-- Garment catalog (shop only)
create table if not exists public.garments (
  id uuid primary key default gen_random_uuid(),
  style text not null,
  brand text not null default '',
  description text not null default '',
  colors text[] not null default '{}',
  cost numeric not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists garments_style_idx on public.garments (lower(style));
alter table public.garments enable row level security;
drop policy if exists garments_staff on public.garments;
create policy garments_staff on public.garments for all using (public.is_staff()) with check (public.is_staff());

-- Art files attached to an order (shop only; stored in the private "proofs" bucket under art/)
create table if not exists public.art_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  name text not null default '',
  file_path text not null,
  file_type text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists art_files_order_idx on public.art_files (order_id);
alter table public.art_files enable row level security;
drop policy if exists art_files_staff on public.art_files;
create policy art_files_staff on public.art_files for all using (public.is_staff()) with check (public.is_staff());

-- A customer's second contact can also sign in to the portal
create or replace function public.my_customer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.customers
  where public.auth_email() <> ''
    and (lower(email) = public.auth_email() or lower(contact2_email) = public.auth_email())
$$;
