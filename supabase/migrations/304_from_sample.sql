-- Nov 11: an order started from a sample (Make the order on a Sample only order): lib/samples.ts FromSample
alter table orders add column if not exists from_sample jsonb;
-- a booking of an order's pre-production sample run (its own card on the schedule; lib/samples.ts)
alter table production_slots add column if not exists sample boolean not null default false;
