-- Master mockups (Oct 31, Nick: "just like you have master artworks, you should have master mockups that can't be
-- deleted… it's being used on too much stuff"). A customer's mockup (by its M-number) marked master can't be taken off:
-- not archived (its last live version), shelved or deleted, the same rule a mockup a program uses already has (249).
-- Saving a new version still works. Anyone on staff can make one master; only someone allowed to unlock master logos
-- (owners, or masterLogos in Settings → User Access) can take it off. Nothing is removed by this migration.
create table if not exists public.mockup_masters (
  customer_id uuid not null references public.customers(id) on delete cascade,
  number int not null,
  at timestamptz not null default now(),
  by text not null default '',
  primary key (customer_id, number)
);
alter table public.mockup_masters enable row level security;
drop policy if exists mockup_masters_staff_read on public.mockup_masters;
create policy mockup_masters_staff_read on public.mockup_masters for select using (public.is_staff());
drop policy if exists mockup_masters_staff_add on public.mockup_masters;
create policy mockup_masters_staff_add on public.mockup_masters for insert with check (public.is_staff());
drop policy if exists mockup_masters_unlock on public.mockup_masters;
create policy mockup_masters_unlock on public.mockup_masters for delete using (
  public.is_staff() and (
    exists (select 1 from public.staff where lower(email) = lower(coalesce(auth.email(), '')) and role = 'owner')
    or coalesce((select (data -> 'access' -> lower(coalesce(auth.email(), '')) ->> 'masterLogos')::boolean from public.settings where id = 1), false)
  )
);

-- why a mockup is kept: it's a master, or a program's price uses it (null: it can be taken off)
create or replace function public.mockup_kept_why(cust uuid, num int) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select 'it''s a master mockup' from mockup_masters m where m.customer_id = cust and m.number = num),
    (select format('it''s used in their program ("%s")', name) from (select public.program_mockup_use(cust, num) as name) x where x.name is not null)
  )
$$;

create or replace function public.keep_program_mockups() returns trigger
language plpgsql security definer set search_path = public as $$
declare why text; r mockups;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if old.number is null or old.customer_id is null then return r; end if;
  why := public.mockup_kept_why(old.customer_id, old.number);
  if why is null then return r; end if;
  if tg_op = 'UPDATE' and new.shelved_at is not null and old.shelved_at is null then
    raise exception 'M-% can''t be taken off: %.', old.number, why using errcode = 'P0001';
  end if;
  if (tg_op = 'DELETE' and old.archived_at is null) or (tg_op = 'UPDATE' and new.archived_at is not null and old.archived_at is null) then
    -- the last live version of the mockup: keep it
    if not exists (select 1 from mockups m where m.customer_id = old.customer_id and m.number = old.number and m.id <> old.id and m.archived_at is null) then
      raise exception 'M-% can''t be taken off: %.', old.number, why using errcode = 'P0001';
    end if;
  end if;
  return r;
end $$;
