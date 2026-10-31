-- A master logo is set in stone (Oct 31, Nick: "once we put it in, it's like, these are locked in stone. It can't be
-- deleted. It's there."). designs.specs.master is set on the logo's page; while it's set, the logo can't be deleted,
-- archived or have its art file replaced, whatever path tries (the page, a server action, a script). Colorways, sew
-- files and details can still be added. Unlocking (clearing specs.master) is an owner's or admin's switch on the page.
create or replace function public.designs_master_guard() returns trigger
language plpgsql as $$
declare
  locked boolean := coalesce(old.specs ? 'master', false) and jsonb_typeof(old.specs -> 'master') = 'object';
begin
  if not locked then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'D-% is a master logo: it can''t be deleted. Unlock it on its page first.', old.number;
  end if;
  if new.archived_at is not null and old.archived_at is null then
    raise exception 'D-% is a master logo: it can''t be archived. Unlock it on its page first.', old.number;
  end if;
  if new.file_path is distinct from old.file_path then
    raise exception 'D-% is a master logo: its art can''t be replaced. Add the new version as a colorway.', old.number;
  end if;
  return new;
end $$;

drop trigger if exists designs_master_guard on public.designs;
create trigger designs_master_guard before update or delete on public.designs
  for each row execute function public.designs_master_guard();
