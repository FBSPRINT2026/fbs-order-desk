-- DraftPunk: recipes as they were in BeerSmith (Nick, Nov 24 2026: "for the imported from BeerSmith recipes… I just want
-- to see them the way they were in BeerSmith"). Import keeps every BeerSmith recipe here, one row each, with its own
-- name, folder and date, nothing grouped. From here a recipe is brought into DraftPunk as a new recipe or as a version
-- of one (each brew system's own version: Witstanbul's 3, 5 and 10 gallon), and remembers where it went.
create table if not exists dp_archive (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  folder text not null default '',
  brewed_on date,
  source text not null default '',
  data jsonb not null default '{}',
  calc jsonb not null default '{}',
  brought_to uuid references dp_recipes(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists dp_archive_owner on dp_archive (owner_id, folder, name);
alter table dp_archive enable row level security;
create policy dp_archive_own on dp_archive for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());
