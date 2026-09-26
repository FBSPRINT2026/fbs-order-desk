-- Same style number can exist under different brands (Gildan 5000 vs Bayside 5000)
drop index if exists public.garments_style_idx;
create unique index if not exists garments_brand_style_idx on public.garments (lower(brand), lower(style));
create unique index if not exists garments_ss_style_idx on public.garments (ss_style_id) where ss_style_id is not null;
