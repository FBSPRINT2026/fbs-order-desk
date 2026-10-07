-- Moving customers off Printavo (Nick, Oct 7, 2026). Run once in Supabase → SQL editor.
--  * customers.moved_at / moved_by / move_checklist: the customer has been moved to the new system (checklist done).
--  * orders.printavo_*: a 40,000-series order's link to the job sent into Printavo (two-way until Nov 2).
--  * order numbers: new orders start at 40,000 (Printavo is at ~34,600). On Nov 2 this becomes 50,000.

alter table public.customers add column if not exists moved_at timestamptz;
alter table public.customers add column if not exists moved_by text not null default '';
alter table public.customers add column if not exists move_checklist jsonb not null default '{}'::jsonb;

alter table public.orders add column if not exists printavo_id text;
alter table public.orders add column if not exists printavo_visual_id text;
alter table public.orders add column if not exists printavo_sent_at timestamptz;
alter table public.orders add column if not exists printavo_state jsonb not null default '{}'::jsonb;
create unique index if not exists orders_printavo_id_key on public.orders (printavo_id) where printavo_id is not null;

-- Little Groupies' Terrible Toddler (#1516) becomes the first 40,000 order; new ones follow from 40,001.
update public.orders set number = 40000 where id = '780fedb6-45e0-4cf3-8f0e-dd394d350b3b' and number = 1516;
alter sequence public.order_number_seq restart with 40001;
