-- Hold the spot from a quote (Nov 9, Nick): a Planner hold tied to its order, with when its details are due and where its art is
alter table public.production_holds add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.production_holds add column if not exists details_due date;
alter table public.production_holds add column if not exists art text not null default '';
create index if not exists production_holds_order_idx on public.production_holds (order_id);
-- Revision (a quote the customer asked changes on, until the new version is sent): shown as its own quote status
alter table public.orders add column if not exists revision_at timestamptz;
-- no Blanks Ordered status any more: those orders are approved (the goods are on the Goods tab)
update public.orders set status = 'approved' where status = 'blanks';
