-- One Stop (third goods supplier, Oct 29 2026): a maker's style at One Stop (every color and size, their codes and
-- barcodes), looked up by brand + the maker's style number and kept a day (lib/onestop.ts osStyle)
create table if not exists onestop_styles (
  key text primary key,
  brand text not null default '',
  style text not null default '',
  items jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now()
);
alter table onestop_styles enable row level security;
