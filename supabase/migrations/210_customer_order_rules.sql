-- What a customer can do to an order (Oct 24, Nick): delete only a sent order we haven't opened; archive quotes;
-- ask us to cancel once we've seen it.
alter table orders add column if not exists staff_seen_at timestamptz;
alter table orders add column if not exists customer_archived_at timestamptz;
alter table orders add column if not exists cancel_requested_at timestamptz;
alter table orders add column if not exists cancel_reason text not null default '';
