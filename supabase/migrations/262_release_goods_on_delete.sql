-- Goods on a deleted order go back to "Shipments not linked" (Nov 2, Nick: "what would happen if I deleted an order…
-- would it go back to… trying to sync it back up… put it back in the bottom where it says it needs to be matched"):
-- the supplier's lines on it become waiting lines again (the matcher picks them up on its next round), with a note
-- saying why. Before this they kept kind 'goods' with no order and showed nowhere.
create or replace function public.release_order_goods() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.supplier_manifest_lines
     set order_id = null, kind = '', match_how = '', linked_by = '', suggest_order_id = null,
         suggest_how = 'Its order #' || old.number || ' was deleted'
   where order_id = old.id;
  return old;
end $$;
drop trigger if exists orders_release_goods on public.orders;
create trigger orders_release_goods before delete on public.orders for each row execute function public.release_order_goods();

-- the ones already left without an order by earlier deletes
update public.supplier_manifest_lines
   set kind = '', match_how = '', linked_by = '', suggest_how = 'Its order was deleted'
 where kind in ('goods', 'blanks') and order_id is null and archived_order_id is null;
