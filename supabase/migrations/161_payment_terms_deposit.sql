-- 50/50 payment terms (Oct 16 2026, Nick): 50% down to start production, the other 50% due at delivery.
alter table public.customers drop constraint if exists customers_payment_terms_check;
alter table public.customers add constraint customers_payment_terms_check check (payment_terms in ('prepay','receipt','net30','deposit'));
