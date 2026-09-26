-- S&S Activewear sync: per-size costs (for 2XL+ material charges), S&S style id, image, last sync time
alter table public.garments add column if not exists size_costs jsonb not null default '{}'::jsonb;
alter table public.garments add column if not exists ss_style_id integer;
alter table public.garments add column if not exists image text not null default '';
alter table public.garments add column if not exists synced_at timestamptz;
