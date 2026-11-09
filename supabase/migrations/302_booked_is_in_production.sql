-- Booked on the production schedule = In Production (Nov 9, Nick: "once Jose adds it to the scheduler… it should be in
-- production"); taken off with nothing else booked = back to Approved
create or replace function order_status_from_slots() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.order_id is not null then
    update orders set status = 'production' where id = new.order_id and status = 'approved';
  end if;
  if tg_op in ('DELETE', 'UPDATE') and old.order_id is not null and (tg_op = 'DELETE' or new.order_id is distinct from old.order_id) then
    if not exists (select 1 from production_slots where order_id = old.order_id and (tg_op = 'DELETE' or id <> old.id)) then
      update orders set status = 'approved' where id = old.order_id and status = 'production';
    end if;
  end if;
  return null;
end $$;
drop trigger if exists production_slots_order_status on production_slots;
create trigger production_slots_order_status after insert or update of order_id or delete on production_slots for each row execute function order_status_from_slots();
