-- Payment terms per customer: prepay, due on receipt, or net 30.
alter table public.customers add column if not exists payment_terms text not null default 'receipt';
alter table public.customers drop constraint if exists customers_payment_terms_check;
alter table public.customers add constraint customers_payment_terms_check check (payment_terms in ('prepay','receipt','net30'));
