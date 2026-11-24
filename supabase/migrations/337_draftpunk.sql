-- DraftPunk: a homebrew recipe app (BeerSmith-like) for Nick and his homebrew club, at portal.fbsprint.com/draftpunk.
-- Its own tables (dp_*), separate from the shop's. Each brewer sees their own things plus what's shared with the club.
-- (Applied Nov 23 2026; see the live database for the exact policies.)
create table if not exists dp_brewers (user_id uuid primary key references auth.users(id) on delete cascade, name text not null default '', club_role text not null default 'member' check (club_role in ('member','admin')), created_at timestamptz not null default now());
create table if not exists dp_equipment (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, name text not null, data jsonb not null default '{}', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists dp_ingredients (id uuid primary key default gen_random_uuid(), owner_id uuid references auth.users(id) on delete cascade, kind text not null check (kind in ('fermentable','hop','yeast','misc','water')), name text not null, data jsonb not null default '{}', in_stock numeric, created_at timestamptz not null default now());
create table if not exists dp_styles (id text primary key, name text not null, guide text not null default 'BJCP 2021', data jsonb not null default '{}');
create table if not exists dp_recipes (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, name text not null, style_id text references dp_styles(id), visibility text not null default 'private' check (visibility in ('private','club')), data jsonb not null default '{}', calc jsonb not null default '{}', copied_from uuid references dp_recipes(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists dp_brews (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id) on delete cascade, recipe_id uuid references dp_recipes(id) on delete set null, brewed_on date not null default current_date, recipe_snapshot jsonb not null default '{}', measured jsonb not null default '{}', notes text not null default '', tasting jsonb not null default '{}', created_at timestamptz not null default now());
create or replace function dp_is_brewer() returns boolean language sql stable security definer set search_path = public as $$ select exists(select 1 from dp_brewers where user_id = auth.uid()) $$;
alter table dp_brewers enable row level security; alter table dp_equipment enable row level security; alter table dp_ingredients enable row level security;
alter table dp_styles enable row level security; alter table dp_recipes enable row level security; alter table dp_brews enable row level security;
create policy dp_brewers_read on dp_brewers for select using (dp_is_brewer());
create policy dp_brewers_own on dp_brewers for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy dp_equipment_own on dp_equipment for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());
create policy dp_ingredients_read on dp_ingredients for select using (dp_is_brewer() and (owner_id is null or owner_id = auth.uid()));
create policy dp_ingredients_own on dp_ingredients for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());
create policy dp_styles_read on dp_styles for select using (dp_is_brewer());
create policy dp_recipes_read on dp_recipes for select using (owner_id = auth.uid() or (visibility = 'club' and dp_is_brewer()));
create policy dp_recipes_own on dp_recipes for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());
create policy dp_brews_own on dp_brews for all using (owner_id = auth.uid()) with check (owner_id = auth.uid() and dp_is_brewer());
