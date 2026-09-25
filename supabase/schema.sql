-- FBS Order Desk: database schema
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.
-- Safe to run once on a new project.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------

-- The signed-in user's email, lowercased ('' when signed out)
create or replace function public.auth_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- ---------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------

-- Shop staff: anyone whose email is listed here can use the shop side.
create table if not exists public.staff (
  email text primary key check (email = lower(email)),
  name text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company text not null default '',
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  notes text not null default '',
  tax_exempt boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists customers_email_idx on public.customers (lower(email));

create sequence if not exists public.order_number_seq start 1001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number int not null unique default nextval('public.order_number_seq'),
  customer_id uuid references public.customers(id) on delete restrict,
  nickname text not null default '',
  status text not null default 'quote'
    check (status in ('quote','quote_sent','approved','art','blanks','production','ready','completed')),
  type text not null default 'quote' check (type in ('quote','invoice')),
  due_date date,
  lines jsonb not null default '[]'::jsonb,
  fees jsonb not null default '[]'::jsonb,
  discount_pct numeric not null default 0,
  tax_exempt boolean not null default false,
  tax_rate numeric,
  waive_setup boolean not null default false,
  notes text not null default '',
  total numeric not null default 0,
  qty int not null default 0,
  sent_at timestamptz,
  approved_at timestamptz,
  approved_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_customer_idx on public.orders (customer_id);
create index if not exists orders_status_idx on public.orders (status);

-- Staff-only notes, kept in their own table so customers can never read them
create table if not exists public.order_internal (
  order_id uuid primary key references public.orders(id) on delete cascade,
  production_notes text not null default ''
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  amount numeric not null check (amount <> 0),
  method text not null default 'Card',
  paid_on date not null default current_date,
  stripe_session_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists payments_order_idx on public.payments (order_id);

create table if not exists public.proofs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  title text not null default '',
  file_path text not null,
  file_type text not null default '',
  status text not null default 'pending' check (status in ('pending','approved','changes')),
  customer_comment text not null default '',
  decided_at timestamptz,
  decided_name text,
  created_at timestamptz not null default now()
);
create index if not exists proofs_order_idx on public.proofs (order_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  author_type text not null check (author_type in ('staff','customer')),
  author_email text not null default '',
  author_name text not null default '',
  body text not null check (length(body) between 1 and 5000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messages_order_idx on public.messages (order_id, created_at);

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null,
  detail text not null default '',
  actor text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, created_at);

-- keep updated_at fresh
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders
  for each row execute function public.touch_updated_at();

-- log the starting status of every new order
create or replace function public.log_order_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.order_events (order_id, kind, detail, actor) values (new.id, 'status', new.status, 'shop');
  insert into public.order_internal (order_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists orders_created on public.orders;
create trigger orders_created after insert on public.orders
  for each row execute function public.log_order_created();

-- ---------------------------------------------------------------
-- Access helpers (security definer so they can read past RLS)
-- ---------------------------------------------------------------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where email = public.auth_email() and public.auth_email() <> '')
$$;

create or replace function public.my_customer_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.customers
  where public.auth_email() <> '' and lower(email) = public.auth_email()
$$;

-- Orders a customer may see: theirs, and not still a draft quote
create or replace function public.my_order_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select id from public.orders
  where status <> 'quote' and customer_id in (select public.my_customer_ids())
$$;

-- ---------------------------------------------------------------
-- Row level security
-- Staff can do everything. Customers can only READ their own records;
-- everything a customer changes goes through the app's server code,
-- which checks ownership first.
-- ---------------------------------------------------------------
alter table public.staff enable row level security;
alter table public.settings enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_internal enable row level security;
alter table public.payments enable row level security;
alter table public.proofs enable row level security;
alter table public.messages enable row level security;
alter table public.order_events enable row level security;

drop policy if exists staff_self_read on public.staff;
create policy staff_self_read on public.staff for select using (email = public.auth_email() or public.is_staff());
drop policy if exists staff_manage on public.staff;
create policy staff_manage on public.staff for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists settings_read on public.settings;
create policy settings_read on public.settings for select using (auth.role() = 'authenticated');
drop policy if exists settings_write on public.settings;
create policy settings_write on public.settings for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists customers_staff on public.customers;
create policy customers_staff on public.customers for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists customers_self on public.customers;
create policy customers_self on public.customers for select using (id in (select public.my_customer_ids()));

drop policy if exists orders_staff on public.orders;
create policy orders_staff on public.orders for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists orders_customer on public.orders;
create policy orders_customer on public.orders for select using (id in (select public.my_order_ids()));

drop policy if exists internal_staff on public.order_internal;
create policy internal_staff on public.order_internal for all using (public.is_staff()) with check (public.is_staff());

drop policy if exists payments_staff on public.payments;
create policy payments_staff on public.payments for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists payments_customer on public.payments;
create policy payments_customer on public.payments for select using (order_id in (select public.my_order_ids()));

drop policy if exists proofs_staff on public.proofs;
create policy proofs_staff on public.proofs for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists proofs_customer on public.proofs;
create policy proofs_customer on public.proofs for select using (order_id in (select public.my_order_ids()));

drop policy if exists messages_staff on public.messages;
create policy messages_staff on public.messages for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists messages_customer on public.messages;
create policy messages_customer on public.messages for select using (order_id in (select public.my_order_ids()));

drop policy if exists events_staff on public.order_events;
create policy events_staff on public.order_events for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists events_customer on public.order_events;
create policy events_customer on public.order_events for select using (order_id in (select public.my_order_ids()));

-- ---------------------------------------------------------------
-- File storage for artwork proofs (private bucket)
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('proofs', 'proofs', false)
on conflict (id) do nothing;

drop policy if exists proofs_files_staff on storage.objects;
create policy proofs_files_staff on storage.objects for all
  using (bucket_id = 'proofs' and public.is_staff())
  with check (bucket_id = 'proofs' and public.is_staff());

-- ---------------------------------------------------------------
-- Starting data
-- ---------------------------------------------------------------
insert into public.settings (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- >>> CHANGE THIS to your own email before running (lowercase) <<<
insert into public.staff (email, name) values ('nicholas@fbsprint.com', 'Nicholas')
on conflict (email) do nothing;
