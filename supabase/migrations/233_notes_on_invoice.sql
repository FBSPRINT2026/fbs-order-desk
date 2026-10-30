-- Print the order's customer notes on its quote / invoice only when staff tick "Add customer notes to invoice"
-- (Oct 30, Nick: "if it is important we will add it to the invoice. If not, it doesn't show").
alter table public.orders add column if not exists notes_on_invoice boolean not null default false;
comment on column public.orders.notes_on_invoice is 'Print the order''s customer notes on its quote / invoice (Oct 30, Nick: a checkbox, off unless it matters)';
