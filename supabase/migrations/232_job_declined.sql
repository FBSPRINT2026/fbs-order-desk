-- A job the customer walked away from (the Job Center's Declined step, Oct 29 2026): when and why. Shown for two weeks,
-- then off the Job Center; the order itself stays.
alter table orders add column if not exists declined_at timestamptz;
alter table orders add column if not exists declined_reason text not null default '';
