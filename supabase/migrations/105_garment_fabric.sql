-- Fabric content from the supplier (S&S style description / SanMar product description): the lines that give fiber
-- percentages, including per-color exceptions ("Heather colors are 50/50 cotton/polyester"). Used to pick the white
-- (cotton vs poly) and the underbase in the Ink Room's estimates.
alter table public.garments add column if not exists fabric text not null default '';
alter table public.garments add column if not exists fabric_at timestamptz;
