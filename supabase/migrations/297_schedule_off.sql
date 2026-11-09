-- Jobs taken off the production schedule (Nov 9, Nick: when the schedule went live, jobs already past printing in
-- Printavo, Ready for finishing, Fulfillment, Shipping, Job completed…, came off it once, before the Printavo sync stopped)
alter table public.orders add column if not exists schedule_off_at timestamptz;
alter table public.orders add column if not exists schedule_off_why text;
