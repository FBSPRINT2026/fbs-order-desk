-- Pay turned off for a person hides employee pay from them in the database too, admins included (Oct 22, Nick:
-- Claudia "shouldn't see anything about employee pay"). employee_pay_admins let every admin read rates; this adds a
-- restrictive rule on top. Owners are never blocked. Additive only.
alter table public.staff add column if not exists pay_off boolean not null default false;
comment on column public.staff.pay_off is 'Pay turned off for this person in User Access (owners never): employee pay rates are hidden from them in the database too, admins included (Oct 22).';
create or replace function public.pay_blocked() returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select pay_off and role <> 'owner' from public.staff where lower(email) = lower(public.auth_email()) limit 1), false)
$$;
create policy employee_pay_not_off on public.employee_pay as restrictive for all using (not public.pay_blocked()) with check (not public.pay_blocked());
update public.staff set pay_off = true where lower(email) = 'claudia@fbsprint.com';
