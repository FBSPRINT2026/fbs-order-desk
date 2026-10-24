-- A deleted order kept its sew-outs from being deleted with it (Oct 24: deleting test order #40135 failed on
-- sewouts_order_id_fkey). The sew-out record stays (its photo and approval are history, and an approved one is on the
-- logo); it just stops pointing at the order.
alter table public.sewouts alter column order_id drop not null;
alter table public.sewouts drop constraint if exists sewouts_order_id_fkey;
alter table public.sewouts add constraint sewouts_order_id_fkey foreign key (order_id) references public.orders(id) on delete set null;
