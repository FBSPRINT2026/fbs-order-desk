-- A customer stars an order to track it on their dashboard (Oct 24, Nick: "star an order or make it a priority… a
-- priority order tracker… tracking this order, here's the current status… on time or waiting on you"). Additive only.
alter table public.orders add column if not exists customer_starred_at timestamptz;
