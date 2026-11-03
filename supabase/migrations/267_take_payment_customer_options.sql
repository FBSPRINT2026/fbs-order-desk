-- Take a payment (Nov 3, Nick): a customer we don't charge the card fee, and one that wants each invoice charged on its own.
alter table public.customers add column if not exists no_card_fee boolean not null default false, add column if not exists charge_split boolean not null default false;
