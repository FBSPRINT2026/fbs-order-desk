-- Logos can be archived (hidden from pickers) once they've been used; unused ones can be deleted.
alter table public.designs add column if not exists archived_at timestamptz;

create or replace function public.designs_in_use(p_customer uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select d.id from public.designs d
  where d.customer_id = p_customer
    and (public.is_staff() or auth.role() = 'service_role' or p_customer in (select public.my_customer_ids()))
    and (exists (select 1 from public.mockups m where d.id = any(m.design_ids))
         or exists (select 1 from public.orders o where o.groups::text like '%' || d.id::text || '%'));
$$;
revoke all on function public.designs_in_use(uuid) from public;
grant execute on function public.designs_in_use(uuid) to authenticated, service_role;
