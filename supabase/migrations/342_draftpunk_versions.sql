-- DraftPunk: recipes that grow (Nick, Nov 24 2026: "one recipe should be able to have multiple versions underneath it…
-- when you brew it, you can say I went with this version… let's go back to three").
-- A recipe (dp_recipes) is the living thing: its data is the working copy being edited, its status says where it is
-- (developing, dialed in, retired). Versions (dp_recipe_versions) are the changes meant to stay, numbered, each with
-- why. A brew (dp_brews) says which version it brewed; what it changed that day stays on the brew (its snapshot against
-- the version) until it's made the next version. A competition entry says which version too.
-- Best-ever recipes (dp_bfe): the club's two reference recipes per style (competition and house), written by the AI
-- assistant from what wins and kept for every member.

alter table dp_recipes add column if not exists status text not null default 'developing' check (status in ('developing', 'dialed', 'retired'));
alter table dp_recipes add column if not exists goal text not null default 'house' check (goal in ('house', 'competition'));

create table if not exists dp_recipe_versions (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references dp_recipes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  num int not null,
  note text not null default '',
  data jsonb not null default '{}',
  calc jsonb not null default '{}',
  made_on date not null default current_date,
  from_brew uuid references dp_brews(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (recipe_id, num)
);
create index if not exists dp_recipe_versions_recipe on dp_recipe_versions (recipe_id, num);
alter table dp_recipe_versions enable row level security;
create policy dp_versions_read on dp_recipe_versions for select using (
  owner_id = auth.uid() or (dp_is_brewer() and exists (select 1 from dp_recipes r where r.id = recipe_id and r.visibility = 'club')));
create policy dp_versions_own on dp_recipe_versions for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());

alter table dp_brews add column if not exists version_id uuid references dp_recipe_versions(id) on delete set null;
alter table dp_entries add column if not exists version_id uuid references dp_recipe_versions(id) on delete set null;

create table if not exists dp_bfe (
  id uuid primary key default gen_random_uuid(),
  style_id text not null references dp_styles(id),
  kind text not null check (kind in ('competition', 'house')),
  data jsonb not null default '{}',
  written_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (style_id, kind)
);
alter table dp_bfe enable row level security;
create policy dp_bfe_read on dp_bfe for select using (dp_is_brewer());
-- written by the server (the assistant), never by a browser
