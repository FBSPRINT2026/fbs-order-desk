-- A master logo's colors and their threads are locked in (Oct 31, Nick: "once we build that sheet, you got to lock that
-- top part in"). On a master logo, a signed-in person without the masterLogos permission (Settings → User Access;
-- owners always) can only fill in a thread a color doesn't have yet: no color added, taken off or renamed, no PMS
-- changed, no thread changed. Saving the colors for the first time (worked out from its colorways until then) is fine.
-- Everything else about the guard is as in 252.
create or replace function public.designs_master_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  locked boolean := coalesce(old.specs ? 'master', false) and jsonb_typeof(old.specs -> 'master') = 'object';
  who text := lower(coalesce(auth.email(), ''));
  allowed boolean;
  oc jsonb := case when jsonb_typeof(old.specs -> 'colors') = 'array' then old.specs -> 'colors' else '[]'::jsonb end;
  nc jsonb := case when jsonb_typeof(new.specs -> 'colors') = 'array' then new.specs -> 'colors' else '[]'::jsonb end;
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
  if coalesce(auth.role(), '') <> 'authenticated' then
    return new;
  end if;
  allowed := exists (select 1 from staff where lower(email) = who and role = 'owner')
    or coalesce((select (data -> 'access' -> who ->> 'masterLogos')::boolean from settings where id = 1), false);
  if coalesce(jsonb_typeof(new.specs -> 'master'), '') <> 'object' and not allowed then
    raise exception 'D-% is a master logo: only someone allowed in Settings → User Access can unlock it.', old.number;
  end if;
  if not allowed and jsonb_array_length(oc) > 0 and oc is distinct from nc then
    if jsonb_array_length(nc) <> jsonb_array_length(oc) or exists (
      select 1 from jsonb_array_elements(oc) o
      where not exists (
        select 1 from jsonb_array_elements(nc) n
        where n ->> 'name' = o ->> 'name' and coalesce(n ->> 'pms', '') = coalesce(o ->> 'pms', '')
          and (coalesce(o ->> 'thread', '') = '' or n ->> 'thread' = o ->> 'thread'))) then
      raise exception 'D-% is a master logo: its colors and threads are locked. Someone allowed in Settings → User Access can change them.', old.number;
    end if;
  end if;
  return new;
end $$;
