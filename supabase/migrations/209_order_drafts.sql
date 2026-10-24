-- Drafts (Oct 24, Nick): a draft order holds a stand-in number below zero (never shown, never sent to QuickBooks: that
-- starts at 40000) until it's saved or sent; then it takes the next real number. A discarded draft is marked and kept
-- out of every list (never deleted; it never had a number).
create sequence if not exists order_draft_seq;
alter table orders add column if not exists draft boolean not null default false;
alter table orders add column if not exists discarded_at timestamptz;
alter table orders alter column number set default (-nextval('order_draft_seq'))::integer;

create or replace function order_number_assign() returns trigger language plpgsql as $$
begin
  if not coalesce(new.draft, false) and new.number < 0 then new.number := nextval('order_number_seq'); end if;
  return new;
end $$;
drop trigger if exists orders_number_assign on orders;
create trigger orders_number_assign before insert on orders for each row execute function order_number_assign();

create or replace function order_commit(p_id uuid) returns integer language plpgsql security definer set search_path = public as $$
declare o record; n integer;
begin
  select id, number, draft, customer_id into o from orders where id = p_id;
  if not found then raise exception 'Order not found.'; end if;
  if not (is_staff() or o.customer_id in (select my_customer_ids())) then raise exception 'Not allowed.'; end if;
  if not o.draft then return o.number; end if;
  n := nextval('order_number_seq');
  update orders set draft = false, discarded_at = null, number = n, created_at = now() where id = p_id;
  return n;
end $$;
grant execute on function order_commit(uuid) to authenticated;

create or replace function order_discard(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare o record;
begin
  select id, draft, customer_id into o from orders where id = p_id;
  if not found then return; end if;
  if not (is_staff() or o.customer_id in (select my_customer_ids())) then raise exception 'Not allowed.'; end if;
  if not o.draft then raise exception 'Only a draft can be discarded.'; end if;
  update orders set discarded_at = now() where id = p_id;
end $$;
grant execute on function order_discard(uuid) to authenticated;
create index if not exists orders_draft_idx on orders (draft) where draft;
