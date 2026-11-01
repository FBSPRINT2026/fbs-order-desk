-- An order that's in Printavo can't be deleted here (Nov 1, Nick, after #40201 and #40202 were sent to Printavo, then
-- deleted here, and ran on in Printavo where nobody here could see them: "create a rule so that can't happen").
-- Delete it in Printavo first; the order page then checks Printavo, clears the link and deletes it
-- (app/shop/orders/delete-actions.ts). Holds for every way of deleting: the order page, bulk delete, any script.
create or replace function orders_keep_printavo_linked() returns trigger language plpgsql as $$
begin
  if old.printavo_id is not null and old.printavo_id::text <> '' then
    raise exception 'Order #% is in Printavo%. Delete it in Printavo first, then delete it here.',
      old.number, coalesce(' as #' || nullif(old.printavo_visual_id::text, ''), '');
  end if;
  return old;
end $$;
drop trigger if exists orders_keep_printavo_linked on orders;
create trigger orders_keep_printavo_linked before delete on orders for each row execute function orders_keep_printavo_linked();
