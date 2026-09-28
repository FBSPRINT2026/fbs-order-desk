-- Everyone at a customer: one company, many contacts (Printavo's contacts all land here under their company).
create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  phone text not null default '',
  title text not null default '',
  is_primary boolean not null default false,
  portal_access boolean not null default true,   -- can sign in to the company's portal with this email
  printavo_id text unique,
  created_at timestamptz not null default now()
);
create index if not exists customer_contacts_customer_idx on public.customer_contacts (customer_id);
create index if not exists customer_contacts_email_idx on public.customer_contacts (lower(email));
alter table public.customer_contacts enable row level security;
drop policy if exists customer_contacts_staff on public.customer_contacts;
create policy customer_contacts_staff on public.customer_contacts for all using (public.is_staff()) with check (public.is_staff());
drop policy if exists customer_contacts_mine on public.customer_contacts;
create policy customer_contacts_mine on public.customer_contacts for select using (customer_id in (select public.my_customer_ids()));

-- a contact with portal access signs in to their company's portal
create or replace function public.my_customer_ids()
 returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select id from public.customers
  where public.auth_email() <> ''
    and (lower(email) = public.auth_email() or lower(contact2_email) = public.auth_email())
  union
  select customer_id from public.customer_contacts
  where public.auth_email() <> '' and portal_access and lower(email) = public.auth_email()
$$;
