-- Transit map by 3-digit ZIP area (like the UPS map): some parts of a state take a day longer than others.
-- ship_zip3: every 3-digit ZIP area in the 50 states + DC, where it sits on the map and the ZIP we price to.
create table if not exists public.ship_zip3 (
  zip3 text primary key,
  st text not null,
  zip text not null,
  city text not null default '',
  x real not null,
  y real not null,
  zips integer not null default 0
);
-- ship_transit_zip3: business days + cost for the priced box, per area, carrier and service. sig = from ZIP + box + weight
-- it was priced with (a changed box re-prices everything). carrier 'none' marks an area with no UPS/FedEx rate.
create table if not exists public.ship_transit_zip3 (
  zip3 text not null,
  zip text not null,
  st text not null,
  carrier text not null,
  service text not null,
  days integer,
  cost numeric,
  delivery_date text,
  sig text not null default '',
  updated_at timestamptz not null default now(),
  primary key (zip3, carrier, service)
);
create index if not exists ship_transit_zip3_svc on public.ship_transit_zip3 (carrier, service);
alter table public.ship_zip3 enable row level security;
alter table public.ship_transit_zip3 enable row level security;
drop policy if exists "staff read ship_zip3" on public.ship_zip3;
create policy "staff read ship_zip3" on public.ship_zip3 for select using (public.is_staff());
drop policy if exists "staff read ship_transit_zip3" on public.ship_transit_zip3;
create policy "staff read ship_transit_zip3" on public.ship_transit_zip3 for select using (public.is_staff());
