-- When a customer can pay an order online (Oct 24, Nick: "You can't pay an invoice just all the time… sometimes we have to
-- confirm details still… shipping later… this invoice hasn't been finalized yet"). pay_mode: null/auto = by status
-- (lib/payReady.ts), 'not_yet', 'deposit', 'ready'. pay_not_final: they can pay, but charges may still change (pay_note
-- says what). Additive only.
alter table public.orders add column if not exists pay_mode text;
alter table public.orders add column if not exists pay_not_final boolean not null default false;
alter table public.orders add column if not exists pay_note text;
