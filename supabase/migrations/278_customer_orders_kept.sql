-- A customer's order is never deleted (Nov 3, Nick: "once they create it… you just can't delete anymore. You can reset it.
-- It can go back on the list as a customer request… we can't delete a customer's request").
-- 1. What they sent, kept as they sent it: request_original is filled the moment an order is sent in (submitted_at set),
--    by any path (portal form, simple order, program, a ClickUp job brought in), so Reset can put it back exactly.
-- 2. An order the customer sent in can't be deleted, by the order page or any other way.

alter table public.orders add column if not exists request_original jsonb;

create or replace function public.orders_keep_request_original() returns trigger language plpgsql as $$
begin
  if new.submitted_at is not null and new.request_original is null
     and (tg_op = 'INSERT' or old.submitted_at is null or new.status = 'request') then
    new.request_original := jsonb_build_object(
      'groups', new.groups, 'lines', new.lines, 'fees', new.fees, 'nickname', new.nickname, 'due_date', new.due_date,
      'po_number', new.po_number, 'delivery_method', new.delivery_method, 'ship_to', new.ship_to, 'notes', new.notes,
      'qty', new.qty, 'price_type', new.price_type, 'kept_at', now());
  end if;
  return new;
end $$;

drop trigger if exists orders_keep_request_original on public.orders;
create trigger orders_keep_request_original before insert or update on public.orders
  for each row execute function public.orders_keep_request_original();

create or replace function public.orders_customer_sent_not_deleted() returns trigger language plpgsql as $$
begin
  if old.submitted_at is not null then
    raise exception 'Order #% was sent in by the customer, so it can''t be deleted. Reset it to their request instead.', old.number;
  end if;
  return old;
end $$;

drop trigger if exists orders_customer_sent_not_deleted on public.orders;
create trigger orders_customer_sent_not_deleted before delete on public.orders
  for each row execute function public.orders_customer_sent_not_deleted();

-- the requests waiting now: kept as they are (an update with nothing changed fires the first trigger)
update public.orders set status = status where submitted_at is not null and status = 'request' and request_original is null;
