-- Customer brand colors (Oct 16 2026, Nick: "Aubrey ISD has set colors… anytime I use red for them it's gotta be their
-- PMS red"). A short list of { name, ink } ("Red", "PMS 199 C") saved on the customer; the Mockup Creator shows them first
-- in every ink dropdown for that customer, on our side and in their portal.
alter table public.customers add column if not exists brand_colors jsonb not null default '[]'::jsonb;
