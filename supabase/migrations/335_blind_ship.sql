-- Blind shipping (Nick, Nov 23 2026: "a lot of times we blind ship… it says from FBS Print 811 Alpha Dr, but it needs to
-- say from Cedar Promos 811 Alpha Dr"): the name the label is shipped from (our address, the customer's name), and
-- each customer's standing choice (null = wholesale customers ship blind, retail don't).
alter table shipments add column if not exists from_name text not null default '';
alter table customers add column if not exists ship_blind boolean;
