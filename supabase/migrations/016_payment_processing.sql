-- Customer payments through Stax (card / ACH) and Zelle / Venmo notices.
alter table public.payments add column if not exists fee numeric not null default 0;
alter table public.payments add column if not exists processor_id text;
alter table public.payments add column if not exists note text;
create table if not exists public.payment_notices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  order_ids uuid[] not null default '{}',
  method text not null,
  amount numeric not null default 0,
  note text not null default '',
  status text not null default 'pending' check (status in ('pending','confirmed','dismissed')),
  created_by text not null default '',
  created_at timestamptz not null default now()
);
alter table public.payment_notices enable row level security;
drop policy if exists payment_notices_staff on public.payment_notices;
create policy payment_notices_staff on public.payment_notices for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists payment_notices_customer on public.payment_notices;
create policy payment_notices_customer on public.payment_notices for select using (customer_id in (select public.my_customer_ids()));
