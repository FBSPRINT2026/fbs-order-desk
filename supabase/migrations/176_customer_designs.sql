-- Each customer's designs catalog (Oct 20, Nick: Dear Heart's repeat designs, every way each one was printed):
-- the catalog is worked out from their orders; this row only keeps staff's changes to it (renames, merges, a job
-- moved to another design, designs hidden)
create table if not exists public.customer_designs (
  customer_id uuid primary key references public.customers(id) on delete cascade,
  rules jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.customer_designs enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'customer_designs' and policyname = 'customer_designs_staff') then
    create policy customer_designs_staff on public.customer_designs for all using ((select public.is_staff())) with check ((select public.is_staff()));
  end if;
end $$;
