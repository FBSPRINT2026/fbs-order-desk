-- Who may unlock a master logo (Oct 31, Nick: "me or Amanda"). It's a permission like the rest of User Access
-- ("masterLogos"): owners always have it; anyone else only when it's turned on for them in Settings → User Access
-- (settings.data.access[email].masterLogos). The page hides the switch from others; this makes the database refuse
-- a signed-in person without it too. Server code (service role) and direct database work aren't a signed-in person.
create or replace function public.designs_master_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  locked boolean := coalesce(old.specs ? 'master', false) and jsonb_typeof(old.specs -> 'master') = 'object';
  who text := lower(coalesce(auth.email(), ''));
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
  if coalesce(jsonb_typeof(new.specs -> 'master'), '') <> 'object' and coalesce(auth.role(), '') = 'authenticated' then
    if not exists (select 1 from staff where lower(email) = who and role = 'owner')
       and coalesce((select (data -> 'access' -> who ->> 'masterLogos')::boolean from settings where id = 1), false) is not true then
      raise exception 'D-% is a master logo: only someone allowed in Settings → User Access can unlock it.', old.number;
    end if;
  end if;
  return new;
end $$;
