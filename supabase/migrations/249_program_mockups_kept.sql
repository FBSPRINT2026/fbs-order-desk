-- A mockup a program uses can't be removed (Oct 30, Nick: "once a mockup is used in their program, it shouldn't be able
-- to be deleted"). One rule in the database, so every way of removing one obeys it: deleting the row, archiving its last
-- live version, or shelving it ("Archive" on the customer's artwork). Saving a new version still works (the new version
-- is saved before the old one is archived), and taking the mockup off the program's price frees it again.
create or replace function program_mockup_use(cust uuid, num int) returns text
language sql stable security definer set search_path = public as $$
  select i.name from program_items i join programs p on p.id = i.program_id
  where p.customer_id = cust and i.archived_at is null and i.active
    and exists (select 1 from jsonb_array_elements(coalesce(i.mockups, '[]'::jsonb)) e where (e->>'n')::int = num)
  order by i.position limit 1
$$;

create or replace function keep_program_mockups() returns trigger
language plpgsql security definer set search_path = public as $$
declare used text; r mockups;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if old.number is null or old.customer_id is null then return r; end if;
  used := program_mockup_use(old.customer_id, old.number);
  if used is null then return r; end if;
  if tg_op = 'UPDATE' and new.shelved_at is not null and old.shelved_at is null then
    raise exception 'M-% is used in their program ("%"). Take it off the program first.', old.number, used using errcode = 'P0001';
  end if;
  if (tg_op = 'DELETE' and old.archived_at is null) or (tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null) then
    -- the last live version of the mockup: keep it
    if not exists (select 1 from mockups m where m.customer_id = old.customer_id and m.number = old.number and m.id <> old.id and m.archived_at is null) then
      raise exception 'M-% is used in their program ("%"). Take it off the program first.', old.number, used using errcode = 'P0001';
    end if;
  end if;
  return r;
end $$;

drop trigger if exists mockups_keep_program on mockups;
create trigger mockups_keep_program before update of archived_at, shelved_at or delete on mockups
  for each row execute function keep_program_mockups();
