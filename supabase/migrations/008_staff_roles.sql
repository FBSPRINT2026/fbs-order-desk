-- Staff roles: owner (sees everything), admin, production, receiving, shipping
alter table public.staff add column if not exists role text not null default 'admin'
  check (role in ('owner','admin','production','receiving','shipping'));
update public.staff set role = 'owner' where lower(email) = 'nicholas@fbsprint.com';

create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.staff where lower(email) = lower(public.auth_email()) limit 1
$$;
grant execute on function public.staff_role() to authenticated;

-- only the owner and admins manage staff logins; only the owner can make or change an owner
drop policy if exists staff_manage on public.staff;
drop policy if exists staff_insert on public.staff;
drop policy if exists staff_update on public.staff;
drop policy if exists staff_delete on public.staff;
create policy staff_insert on public.staff for insert
  with check (public.staff_role() in ('owner','admin') and (role <> 'owner' or public.staff_role() = 'owner'));
create policy staff_update on public.staff for update
  using (public.staff_role() in ('owner','admin') and (role <> 'owner' or public.staff_role() = 'owner'))
  with check (public.staff_role() in ('owner','admin') and (role <> 'owner' or public.staff_role() = 'owner'));
create policy staff_delete on public.staff for delete
  using (public.staff_role() in ('owner','admin') and role <> 'owner');
