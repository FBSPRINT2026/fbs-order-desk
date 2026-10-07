-- "Can see employee pay rates" (Settings → User Access), Nick, Oct 7, 2026: Jose Moreno (production lead) sees what
-- everyone makes, to work out overtime and labor cost. Read only: changing pay stays owner / admin.
-- The flag lives on the staff record (only owners and admins can change staff), kept in step by the User Access page.
alter table public.staff add column if not exists sees_pay boolean not null default false;

create or replace function public.sees_pay() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select sees_pay from public.staff where lower(email) = lower(public.auth_email()) limit 1), false)
$$;
grant execute on function public.sees_pay() to authenticated;

-- owners / admins: everything (as before); anyone with sees_pay: read only
drop policy if exists employee_pay_read on public.employee_pay;
create policy employee_pay_read on public.employee_pay for select using (public.sees_pay());
