-- High priority (Nick, Nov 16 2026): a job that needs a little more attention, an extra set of eyes
-- (Peter's MEI cart orders that are "high profile"). Beside Rush and Firm; never shown to the customer.
alter table public.orders add column if not exists priority boolean not null default false;
alter table public.orders add column if not exists priority_note text;
