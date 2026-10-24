-- Order numbers are one and done once they've been in QuickBooks (Oct 24, Nick: "you can't use a number twice in
-- QuickBooks… you can never use that number again after it's synced with QuickBooks… it has to be a one and done
-- thing"). Every invoice number that has been in QuickBooks is kept here, even after its order is deleted, and an order
-- can't take a number that's here for a different order.
create table if not exists public.qbo_doc_numbers (
  doc_number text primary key,
  order_number integer,
  order_id uuid,
  qbo_id text not null default '',
  source text not null default '',
  at timestamptz not null default now(),
  voided_at timestamptz,
  order_deleted_at timestamptz
);
create index if not exists qbo_doc_numbers_num_idx on public.qbo_doc_numbers (order_number);
alter table public.qbo_doc_numbers enable row level security;
drop policy if exists qbo_doc_numbers_staff on public.qbo_doc_numbers;
create policy qbo_doc_numbers_staff on public.qbo_doc_numbers for select using (public.is_staff());

-- what's already linked
insert into public.qbo_doc_numbers (doc_number, order_number, order_id, qbo_id, source)
select l.last_seen_qbo->>'DocNumber', nullif(regexp_replace(l.last_seen_qbo->>'DocNumber', '\D', '', 'g'), '')::integer, o.id, l.qbo_id, l.source
from public.qbo_links l left join public.orders o on o.id::text = l.local_id
where l.entity = 'invoice' and coalesce(l.last_seen_qbo->>'DocNumber', '') <> ''
on conflict (doc_number) do nothing;

create or replace function public.qbo_number_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from qbo_doc_numbers d where d.doc_number = new.number::text and d.order_id is distinct from new.id) then
    raise exception 'Order number % was already used in QuickBooks, so it can''t be used again.', new.number;
  end if;
  return new;
end $$;
drop trigger if exists qbo_number_guard on public.orders;
create trigger qbo_number_guard before insert or update of number on public.orders for each row execute function public.qbo_number_guard();

-- a deleted order's numbers stay taken
create or replace function public.qbo_number_order_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update qbo_doc_numbers set order_deleted_at = now() where order_id = old.id and order_deleted_at is null;
  return old;
end $$;
drop trigger if exists qbo_number_order_gone on public.orders;
create trigger qbo_number_order_gone after delete on public.orders for each row execute function public.qbo_number_order_gone();
