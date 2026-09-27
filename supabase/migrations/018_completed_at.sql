-- When an order is closed (moved to completed). Due-on-receipt and net-30 payments count from this.
alter table public.orders add column if not exists completed_at timestamptz;
update public.orders set completed_at = coalesce(updated_at, created_at) where status = 'completed' and completed_at is null;
create or replace function public.orders_completed_at() returns trigger language plpgsql as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status is distinct from 'completed') and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'completed' and tg_op = 'UPDATE' and old.status = 'completed' then
    new.completed_at := null;
  end if;
  return new;
end $$;
drop trigger if exists orders_completed_at on public.orders;
create trigger orders_completed_at before insert or update of status on public.orders for each row execute function public.orders_completed_at();
