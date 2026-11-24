-- DraftPunk: the brewery page (Nick, Nov 24 2026: photos of his fermentation chambers, keezer and RIMS stand, "very
-- visual representations… a very graphical layout"). A chamber now says what it is (upright fridge, chest freezer)
-- and kegs are kept: what's in each one in the keezer, how full, its pressure, when it was tapped.
alter table dp_chambers add column if not exists kind text not null default 'upright' check (kind in ('upright', 'chest'));
create table if not exists dp_kegs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  place text not null default 'Keezer',
  slot int not null default 1,
  beer text not null default '',
  brew_id uuid references dp_brews(id) on delete set null,
  color text not null default '',
  size_gal numeric not null default 5,
  left_gal numeric not null default 0,
  psi numeric,
  tapped_on date,
  status text not null default 'empty' check (status in ('serving', 'carbonating', 'conditioning', 'empty', 'clean')),
  created_at timestamptz not null default now()
);
create index if not exists dp_kegs_owner on dp_kegs (owner_id, place, slot);
alter table dp_kegs enable row level security;
create policy dp_kegs_read on dp_kegs for select using (dp_is_brewer());
create policy dp_kegs_own on dp_kegs for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());
