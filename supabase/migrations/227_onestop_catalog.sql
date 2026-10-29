-- One Stop's catalog, one row per style (their code, the maker and the maker's style number, name, photo), copied
-- weekly from their API (lib/onestop.ts osCatalogSync) so the garment search finds their styles by brand, number or name
-- (their own search only knows their codes) (Oct 29 2026)
create table if not exists onestop_catalog (
  style text primary key,
  brand text not null default '',
  mill_code text not null default '',
  mill_style_code text not null default '',
  title text not null default '',
  image text not null default '',
  filters text not null default '',
  sizes text not null default '',
  active boolean not null default true,
  synced_at timestamptz not null default now()
);
create index if not exists onestop_catalog_mill_style on onestop_catalog (lower(mill_style_code));
alter table onestop_catalog enable row level security;
