-- The youth style that goes with an adult style (Oct 21, Nick: "1717 … the corresponding youth is the 9018; Gildan
-- 5000 → 5000B… if you don't know, ask me and remember it"). "+ Add youth" on an order's garments reads it; a pair
-- someone keys in (or picks from the catalog's suggestions) is saved here. Staff only, through the server.
create table if not exists garment_youth (
  adult text primary key,          -- the adult style, upper case ("1717")
  adult_brand text not null default '',
  youth text not null,             -- the youth style ("9018")
  youth_brand text not null default '',
  source text not null default 'staff',  -- staff (keyed in or picked) / catalog (matched by name)
  by text not null default '',
  at timestamptz not null default now()
);
alter table garment_youth enable row level security;

insert into garment_youth (adult, adult_brand, youth, youth_brand, source, by) values
  ('1717', 'Comfort Colors', '9018', 'Comfort Colors', 'staff', 'Nick'),
  ('5000', 'Gildan', '5000B', 'Gildan', 'staff', 'Nick')
on conflict (adult) do nothing;
