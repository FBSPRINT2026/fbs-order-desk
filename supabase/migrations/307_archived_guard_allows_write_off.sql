-- Locked Printavo history may change its balance by what's paid here and, now, by what's written off (written_off).
CREATE OR REPLACE FUNCTION public.archived_orders_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.locked then raise exception 'Printavo order #% is locked history (before 2026): it can''t be deleted', old.visual_id; end if;
    return old;
  end if;
  if old.locked then
    if not new.locked then raise exception 'Printavo order #% is locked history (before 2026): it can''t be unlocked here', old.visual_id; end if;
    if new.data is distinct from old.data or new.data_hash is distinct from old.data_hash or new.printavo_id is distinct from old.printavo_id
       or new.kind is distinct from old.kind or new.visual_id is distinct from old.visual_id or new.nickname is distinct from old.nickname
       or new.status_name is distinct from old.status_name or new.status_color is distinct from old.status_color
       or new.order_date is distinct from old.order_date or new.due_date is distinct from old.due_date
       or new.total is distinct from old.total or ((new.paid is distinct from old.paid or new.balance is distinct from old.balance) and not (new.paid = coalesce((old.data->>'amountPaid')::numeric, 0) + new.paid_here and new.balance = greatest(0, coalesce((old.data->>'amountOutstanding')::numeric, old.total, 0) - new.paid_here - coalesce(new.written_off, 0))))
       or new.qty is distinct from old.qty or new.po_number is distinct from old.po_number or new.files_total is distinct from old.files_total then
      raise exception 'Printavo order #% is locked history (before 2026): its record can''t change', old.visual_id;
    end if;
    if exists (select 1 from jsonb_each_text(coalesce(old.files, '{}'::jsonb)) f
               where f.value not in ('failed', 'too-big') and (new.files ->> f.key) is distinct from f.value) then
      raise exception 'Printavo order #% is locked history (before 2026): its copied files can''t be removed', old.visual_id;
    end if;
  end if;
  return new;
end $function$;
