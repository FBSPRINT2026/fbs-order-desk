-- Staff-only customer fields live in their own table.
-- Customers can read their own `customers` row (the portal needs it), so anything private
-- (internal notes, tags, follow-up date, account owner, last contact) moves to customer_private,
-- which only staff can read. customers.notes is copied over and then cleared.

create table if not exists public.customer_private (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  notes text not null default '',
  tags text[] not null default '{}',
  next_follow_up date,
  owner_email text not null default '',
  last_contact_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists customer_private_follow_up_idx on public.customer_private (next_follow_up) where next_follow_up is not null;
drop trigger if exists customer_private_touch on public.customer_private;
create trigger customer_private_touch before update on public.customer_private
  for each row execute function public.touch_updated_at();
alter table public.customer_private enable row level security;
drop policy if exists customer_private_staff on public.customer_private;
create policy customer_private_staff on public.customer_private for all using (public.is_staff()) with check (public.is_staff());

-- move what's there today
insert into public.customer_private (customer_id, notes, tags, next_follow_up, owner_email, last_contact_at)
select id, coalesce(notes, ''), coalesce(tags, '{}'), next_follow_up, coalesce(owner_email, ''), last_contact_at from public.customers
on conflict (customer_id) do update set notes = excluded.notes, tags = excluded.tags, next_follow_up = excluded.next_follow_up,
  owner_email = excluded.owner_email, last_contact_at = excluded.last_contact_at;
update public.customers set notes = '' where notes <> '';

-- every new customer gets a private row
create or replace function public.customer_private_row() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.customer_private (customer_id, notes) values (new.id, coalesce(new.notes, '')) on conflict do nothing;
  return new;
end $$;
revoke all on function public.customer_private_row() from public, anon, authenticated;
drop trigger if exists customers_private_row on public.customers;
create trigger customers_private_row after insert on public.customers for each row execute function public.customer_private_row();

-- last contact now lands in the private table
create or replace function public.touch_customer_contact() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; ts timestamptz;
begin
  if tg_table_name = 'activities' then
    cid := new.customer_id;
    ts := new.occurred_at;
  else
    cid := coalesce(new.customer_id, (select customer_id from public.orders where id = new.order_id));
    ts := new.created_at;
  end if;
  if cid is not null then
    insert into public.customer_private (customer_id, last_contact_at) values (cid, coalesce(ts, now()))
    on conflict (customer_id) do update set last_contact_at = greatest(coalesce(public.customer_private.last_contact_at, 'epoch'::timestamptz), excluded.last_contact_at);
  end if;
  return new;
end $$;

-- the columns added in 020 are no longer used on customers
drop index if exists public.customers_follow_up_idx;
alter table public.customers drop column if exists tags;
alter table public.customers drop column if exists next_follow_up;
alter table public.customers drop column if exists owner_email;
alter table public.customers drop column if exists last_contact_at;
