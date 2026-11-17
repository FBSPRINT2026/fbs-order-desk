-- Run together (Nick, Nov 16 2026: NCM's two orders from Nine18): separate orders that print in one run and price the
-- same print on their pieces together. run_id is shared by the orders in a run; run_ctx is each order's view of the
-- others (lib/runTogether.ts), kept in step by app/shop/run-actions.ts.
alter table public.orders add column if not exists run_id uuid, add column if not exists run_ctx jsonb;
create index if not exists orders_run_id_idx on public.orders(run_id) where run_id is not null;
