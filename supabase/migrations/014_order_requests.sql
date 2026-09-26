-- Orders customers build in their portal: status 'request' until the shop prices them.
-- submitted_at is set when the customer sends it in (before that it's their draft). source = 'portal' for these.
alter table public.orders add column if not exists submitted_at timestamptz;
alter table public.orders add column if not exists source text not null default 'shop';
create index if not exists orders_request_idx on public.orders(status) where status = 'request';
