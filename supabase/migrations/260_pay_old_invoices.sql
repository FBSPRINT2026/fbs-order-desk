-- Paying old (Printavo) invoices in the portal (Nov 2, Nick: "as we transition customers into the new system, they
-- should be able to pay in our new system only… I'm going to disable payment in Printavo"). A payment can be on an
-- old invoice instead of a new order; the old invoice keeps Printavo's numbers in `data` and our payments in paid_here,
-- and its paid / balance are Printavo's plus ours, kept right by a trigger (and by the sync when it reads it again).
alter table public.payments alter column order_id drop not null;
alter table public.payments add column if not exists archived_order_id uuid references public.archived_orders(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'payments_on_an_order') then
    alter table public.payments add constraint payments_on_an_order check (order_id is not null or archived_order_id is not null);
  end if;
end $$;
create index if not exists payments_archived on public.payments (archived_order_id) where archived_order_id is not null;
alter table public.archived_orders add column if not exists paid_here numeric not null default 0;

create or replace function public.archived_paid_refresh(p_id uuid) returns void
 language sql security definer set search_path to 'public'
as $$
  update archived_orders a set
    paid_here = s.amt,
    paid = coalesce((a.data->>'amountPaid')::numeric, 0) + s.amt,
    balance = greatest(0, coalesce((a.data->>'amountOutstanding')::numeric, a.total, 0) - s.amt)
  from (select coalesce(sum(amount), 0) amt from payments where archived_order_id = p_id) s
  where a.id = p_id;
$$;

create or replace function public.payments_archived_trg() returns trigger
 language plpgsql security definer set search_path to 'public'
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.archived_order_id is not null then perform archived_paid_refresh(old.archived_order_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.archived_order_id is not null then perform archived_paid_refresh(new.archived_order_id); end if;
  return null;
end $$;
drop trigger if exists payments_archived on public.payments;
create trigger payments_archived after insert or update or delete on public.payments for each row execute function public.payments_archived_trg();

-- locked history (before 2026) may still get paid here: its paid / balance may change, but only to Printavo's numbers
-- plus our own payments
do $$
declare def text;
begin
  select pg_get_functiondef('public.archived_orders_guard()'::regprocedure) into def;
  if position('paid_here' in def) = 0 then
    execute replace(def,
      'or new.paid is distinct from old.paid or new.balance is distinct from old.balance',
      'or ((new.paid is distinct from old.paid or new.balance is distinct from old.balance) and not (new.paid = coalesce((old.data->>''amountPaid'')::numeric, 0) + new.paid_here and new.balance = greatest(0, coalesce((old.data->>''amountOutstanding'')::numeric, old.total, 0) - new.paid_here)))');
  end if;
end $$;
revoke execute on function public.archived_paid_refresh(uuid) from anon, authenticated;
