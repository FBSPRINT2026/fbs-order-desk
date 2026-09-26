-- Favorite (starred) designs, general customer messages (not tied to one order), and which order group a mockup belongs to.

alter table public.designs add column if not exists starred boolean not null default false;

alter table public.mockups add column if not exists group_id text;

alter table public.messages alter column order_id drop not null;
alter table public.messages add column if not exists customer_id uuid references public.customers(id) on delete cascade;
create index if not exists messages_customer_idx on public.messages(customer_id);

-- customers can read general messages on their own accounts
drop policy if exists messages_customer_general on public.messages;
create policy messages_customer_general on public.messages for select using (customer_id in (select public.my_customer_ids()));

-- customers can star/unstar their own designs (only that one column changes)
create or replace function public.set_design_star(p_design uuid, p_starred boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_staff() or exists (select 1 from public.designs d where d.id = p_design and d.customer_id in (select public.my_customer_ids()))) then
    raise exception 'not allowed';
  end if;
  update public.designs set starred = p_starred where id = p_design;
end $$;
revoke all on function public.set_design_star(uuid, boolean) from public;
grant execute on function public.set_design_star(uuid, boolean) to authenticated;
