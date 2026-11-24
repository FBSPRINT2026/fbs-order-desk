-- DraftPunk: competition entries (Nick, Nov 24 2026; he and Jeff are competition brewers, 2017 Ninkasi Award winners).
-- One row per entry: the competition, the BJCP category entered, the recipe and brew it came from, each judge's
-- scoresheet (aroma /12, appearance /3, flavor /20, mouthfeel /5, overall /10) and the result. A brewer edits their own;
-- every club member can see the club's entries (the medal wall).
create table if not exists dp_entries (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  competition text not null default '',
  held_on date,
  style_id text,
  entry_name text not null default '',
  recipe_id uuid references dp_recipes(id) on delete set null,
  brew_id uuid references dp_brews(id) on delete set null,
  scores jsonb not null default '[]',
  place text not null default '' check (place in ('', 'gold', 'silver', 'bronze', 'hm', 'bos', 'ninkasi')),
  mini_bos boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists dp_entries_owner on dp_entries (owner_id, held_on desc);
alter table dp_entries enable row level security;
create policy dp_entries_read on dp_entries for select using (dp_is_brewer());
create policy dp_entries_own on dp_entries for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());
