-- Allow the 'request' status (orders customers build in their portal).
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check check (status = any (array['request','quote','quote_sent','approved','art','blanks','production','ready','completed']));
