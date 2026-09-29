-- Transit time map: UPS / FedEx business days (and price) from our ZIP to one main city in every state.
-- Filled by /api/shipping/transit (EasyPost rates, no labels bought); refreshed on demand, about weekly.
create table if not exists public.ship_transit (
  state text not null,
  zip text not null,
  city text not null default '',
  carrier text not null,
  service text not null,
  days integer,
  cost numeric,
  delivery_date text,
  from_zip text not null default '',
  updated_at timestamptz not null default now(),
  primary key (state, carrier, service)
);
alter table public.ship_transit enable row level security;
drop policy if exists "staff read ship_transit" on public.ship_transit;
create policy "staff read ship_transit" on public.ship_transit for select using (public.is_staff());
