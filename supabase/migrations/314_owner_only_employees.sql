-- People only the owner sees (Nick, Nov 13 2026: "hide Amanda and I from the employee list… they shouldn't see our
-- salaries… the only one should see Amanda and I is myself"). employees.owner_only hides the person, their pay, punches,
-- time off, shifts, paydays and labor from every login but the owner's, in the database itself (restrictive policies),
-- so no page can show them by mistake. The person's own phone and the time clock read with the server key, unaffected.
alter table public.employees add column if not exists owner_only boolean not null default false;

create or replace function public.sees_owner_only() returns boolean
  language sql stable security definer set search_path to 'public'
  as $$ select coalesce(public.staff_role() = 'owner', false) $$;

create or replace function public.employee_visible(eid uuid) returns boolean
  language sql stable security definer set search_path to 'public'
  as $$ select eid is null or public.sees_owner_only() or not coalesce((select owner_only from public.employees where id = eid), false) $$;

drop policy if exists employees_owner_only on public.employees;
create policy employees_owner_only on public.employees as restrictive for all to public
  using (not owner_only or public.sees_owner_only()) with check (not owner_only or public.sees_owner_only());

do $$
declare t text;
begin
  foreach t in array array['employee_pay','pay_advances','payday_lines','time_punches','time_off','shifts','job_time','press_actuals','job_assignments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner_only', t);
    execute format('create policy %I on public.%I as restrictive for all to public using (public.employee_visible(employee_id)) with check (public.employee_visible(employee_id))', t || '_owner_only', t);
  end loop;
end $$;

update public.employees set owner_only = true where code in (115, 128);
