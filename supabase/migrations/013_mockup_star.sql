-- Favorite (starred) mockups, like starred logos.
alter table public.mockups add column if not exists starred boolean not null default false;
create or replace function public.set_mockup_star(p_mockup uuid, p_starred boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_staff() or exists (select 1 from public.mockups m where m.id = p_mockup and m.customer_id in (select public.my_customer_ids()))) then
    raise exception 'not allowed';
  end if;
  update public.mockups set starred = p_starred where id = p_mockup;
end $$;
revoke all on function public.set_mockup_star(uuid, boolean) from public;
grant execute on function public.set_mockup_star(uuid, boolean) to authenticated;
