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

-- Fermentation chambers and autopilot (Nick, Nov 24 2026: "inkbird temp controllers you can log… every fermentation
-- has its own controlled space… implement diacetyl tests or step fermentation automatically… alarms"). A reading is a
-- Tilt's (source 'tilt', with sg) or a chamber controller's (source 'inkbird', temp_f and set_f). A brew log's
-- autopilot state lives in dp_brews.measured.autopilot; the cron in app/api/cron/draftpunk runs it every 15 minutes.
alter table dp_readings add column if not exists source text not null default 'tilt';
alter table dp_readings add column if not exists set_f numeric;
alter table dp_readings add column if not exists chamber_id uuid;
create table if not exists dp_chambers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  -- the Inkbird's Tuya device id (Tuya cloud control), blank when it's logged some other way
  device_id text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);
alter table dp_chambers enable row level security;
create policy dp_chambers_own on dp_chambers for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());
create index if not exists dp_readings_chamber on dp_readings (chamber_id, read_at);

-- A member changes only their own name; their club role and private Tilt key are set by the server (a club admin's
-- Add member, the Tilt address) and a member never reads another's key (dp_brewers_read lets every brewer read the
-- club list).
revoke update on dp_brewers from anon, authenticated;
grant update (name) on dp_brewers to authenticated;
revoke select on dp_brewers from anon, authenticated;
grant select (user_id, name, club_role, created_at) on dp_brewers to authenticated;
