-- DraftPunk: Tilt hydrometer readings (Nick, Nov 24 2026: "we use tilt monitors we can incorporate into the software").
-- The Tilt app / TiltPi "cloud logging" posts each reading to /api/draftpunk/tilt?k=<the brewer's key>; a reading goes
-- to that brewer's newest brew log set to the same Tilt color. Each brewer sees only their own readings.
alter table dp_brewers add column if not exists tilt_key text unique;
create table if not exists dp_readings (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  brew_id uuid references dp_brews(id) on delete set null,
  color text not null default '',
  sg numeric, temp_f numeric,
  read_at timestamptz not null default now()
);
create index if not exists dp_readings_brew on dp_readings (brew_id, read_at);
alter table dp_readings enable row level security;
create policy dp_readings_own on dp_readings for select using (owner_id = auth.uid());
