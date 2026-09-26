-- Designs: each piece of customer art is its own record (D-10001, D-10002, ...) under the customer's account
create sequence if not exists public.design_number_seq start 10001;
create table if not exists public.designs (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique default nextval('public.design_number_seq'),
  customer_id uuid references public.customers(id) on delete set null,
  name text not null default '',
  file_path text not null default '',
  file_name text not null default '',
  file_type text not null default '',
  preview_path text not null default '',
  width_px integer,
  height_px integer,
  method text not null default 'screen',
  colors integer not null default 1,
  inks text not null default '',
  notes text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists designs_customer_idx on public.designs (customer_id);
alter table public.designs enable row level security;
drop policy if exists designs_staff on public.designs;
create policy designs_staff on public.designs for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists designs_customer_read on public.designs;
create policy designs_customer_read on public.designs for select using (customer_id in (select public.my_customer_ids()));
