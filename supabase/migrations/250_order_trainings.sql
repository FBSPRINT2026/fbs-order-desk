-- Several Create order trainings per customer (Oct 30, Nick: Amanda training "another whole separate training for 9/18":
-- Nine18 orders for All My Sons, Armstrong, Johnson… each with its own rules). One row per training: its name, the words
-- in a job that pick it ("AMS, All My Sons"; none = every job of theirs) and its rules. The single training kept on
-- customer_private (246–247) is copied in; those columns stay, unused. Additive only.
create table if not exists public.order_trainings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  name text not null default '',
  when_words text not null default '',
  rules text not null default '',
  updated_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists order_trainings_customer on public.order_trainings (customer_id) where archived_at is null;
alter table public.order_trainings enable row level security;
drop policy if exists order_trainings_staff on public.order_trainings;
create policy order_trainings_staff on public.order_trainings for all using (public.is_staff()) with check (public.is_staff());

insert into public.order_trainings (customer_id, name, when_words, rules, updated_by)
select p.customer_id, coalesce(nullif(p.order_training_name, ''), 'Training'), coalesce(p.order_training_when, ''), p.order_training, 'moved from the customer'
from public.customer_private p
where coalesce(p.order_training, '') <> ''
  and not exists (select 1 from public.order_trainings t where t.customer_id = p.customer_id);
