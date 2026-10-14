-- Prices by design: "flat" (one price at any quantity, e.g. every time we print this design it's that price) or
-- "breaks" (by quantity, e.g. Furry Feline's Mewjira 100+ / 150+ / 200+). Oct 14, Nick.
alter table public.program_items add column if not exists price_mode text not null default 'breaks';
