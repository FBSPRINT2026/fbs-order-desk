-- Design catalog per customer (Oct 20, Nick: "be able to click a button under the customer settings… enable…
-- the same thing we did for Dear Heart"): the customer's Designs tab, their orders grouped by design with a picture.
-- Turned on for Dear Heart Designs and Little Groupies.
alter table public.customers add column if not exists design_catalog boolean not null default false;
update public.customers set design_catalog = true where id in ('d87eccc8-9c75-4fbb-8b98-06f1cbbda31f','fc0c3ba4-b73e-455e-b0b4-7df53905a1d1');
