-- Catalog garments can come from S&S (ss_style_id) or SanMar (supplier = 'sanmar', supplier_style = their style #).
alter table public.garments add column if not exists supplier text not null default 'ss';
alter table public.garments add column if not exists supplier_style text not null default '';
