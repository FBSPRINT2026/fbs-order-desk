-- Program pricing rate card (Oct 14, Nick): customers between retail and wholesale (Peticolas, Nine18, Furry Feline).
-- programs.rate_card: base shirt, price per print (front/back colors), markup on the blank-cost difference, minimum,
-- 2XL+ charge, setup waived (lib/programs.ts RateCard). orders.use_program: the order is priced by it ("Program" chip).
alter table public.programs add column if not exists rate_card jsonb;
alter table public.orders add column if not exists use_program boolean not null default false;
