-- Customer supplied transfers on the Goods panel and in Goods & receiving (Oct 31, Nick: "make this Customer Supplied DTF
-- … on the Goods page.. like shirts its customer supplied. Peter often give us the order number. So when you check it it
-- adds items to the goods page"). One row per batch of their transfers (who made them + their order number), kept in
-- step with the order's prints by a trigger: ticking "Customer supplied transfers" on a print adds it, filling in who
-- made them and their order # updates it, unticking it marks it gone (never deleted). Tracking and received live here.
create table if not exists public.order_supplies (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  kind text not null default 'transfers',
  vendor text not null default '',
  ref text not null default '',
  prints text[] not null default '{}',
  where_text text not null default '',
  status text not null default 'waiting', -- waiting | on_way | received | gone
  expected date,
  carrier text not null default '',
  tracking text not null default '',
  tracker_id text,
  track_status text,
  track_detail text,
  est_delivery timestamptz,
  delivered_at timestamptz,
  track_updated_at timestamptz,
  received_at timestamptz,
  received_by text,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_supplies_order on public.order_supplies(order_id);
create index if not exists order_supplies_open on public.order_supplies(status) where status not in ('received', 'gone');
alter table public.order_supplies enable row level security;
drop policy if exists order_supplies_staff on public.order_supplies;
create policy order_supplies_staff on public.order_supplies for all using (public.is_staff()) with check (public.is_staff());

-- the order's supplied prints → its rows: matched by their order # first, else by a print they share, so typing a name
-- or a number changes the same row
create or replace function public.sync_order_supplies(oid uuid, gs jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare w record; hit uuid; kept uuid[] := '{}';
begin
  for w in
    select coalesce(trim(im->'supplied'->>'by'), '') as vendor, coalesce(trim(im->'supplied'->>'ref'), '') as ref,
           array_agg(im->>'id') as prints,
           coalesce(string_agg(distinct nullif(trim(coalesce(nullif(trim(im->'supplied'->>'where'), ''), im->>'location', '')), ''), ', '), '') as where_text
    from jsonb_array_elements(case when jsonb_typeof(gs) = 'array' then gs else '[]'::jsonb end) g,
         jsonb_array_elements(case when jsonb_typeof(g->'imprints') = 'array' then g->'imprints' else '[]'::jsonb end) im
    where jsonb_typeof(im->'supplied') = 'object'
    group by 1, 2
  loop
    hit := null;
    if w.ref <> '' then
      select id into hit from order_supplies where order_id = oid and kind = 'transfers' and lower(ref) = lower(w.ref) and not (id = any(kept)) limit 1;
    end if;
    if hit is null then
      select id into hit from order_supplies where order_id = oid and kind = 'transfers' and prints && w.prints and not (id = any(kept)) order by updated_at desc limit 1;
    end if;
    if hit is null then
      insert into order_supplies (order_id, kind, vendor, ref, prints, where_text) values (oid, 'transfers', w.vendor, w.ref, w.prints, w.where_text) returning id into hit;
    else
      update order_supplies set vendor = w.vendor, ref = w.ref, prints = w.prints, where_text = w.where_text,
        status = case when status = 'gone' then (case when received_at is not null then 'received' when tracking <> '' then 'on_way' else 'waiting' end) else status end,
        updated_at = now()
      where id = hit and (vendor, ref, prints, where_text, status) is distinct from (w.vendor, w.ref, w.prints, w.where_text, status);
    end if;
    kept := kept || hit;
  end loop;
  update order_supplies set status = 'gone', updated_at = now()
    where order_id = oid and kind = 'transfers' and not (id = any(kept)) and status not in ('gone', 'received');
end $$;

create or replace function public.order_supplies_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.groups is not distinct from old.groups then return new; end if;
  perform public.sync_order_supplies(new.id, new.groups);
  return new;
end $$;
drop trigger if exists orders_sync_supplies on public.orders;
create trigger orders_sync_supplies after insert or update of groups on public.orders for each row execute function public.order_supplies_trigger();

-- the orders that already have customer supplied transfers
do $$ declare r record; begin
  for r in select id, groups from public.orders where groups::text like '%"supplied"%' loop
    perform public.sync_order_supplies(r.id, r.groups);
  end loop;
end $$;
