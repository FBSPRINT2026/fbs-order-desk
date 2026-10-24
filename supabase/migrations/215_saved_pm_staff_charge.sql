-- A customer can let the shop charge a saved card or bank account when they ask (Oct 24, Nick: "can you go in and run my
-- card? You'll have it saved on file… we can go in and do that on our side"). Off unless the customer turns it on, with
-- the words they agreed to and when. Additive only.
alter table public.saved_payment_methods add column if not exists staff_charge_ok boolean not null default false;
alter table public.saved_payment_methods add column if not exists staff_charge_consent text;
alter table public.saved_payment_methods add column if not exists staff_charge_at timestamptz;
alter table public.saved_payment_methods add column if not exists staff_charge_by text;
