-- Saved sales sheet layouts (Oct 24, Nick: "save a layout and name it… when they use their sales tools moving forward,
-- they should be able to… select it"). owner = 'customer:<id>' (portal) or 'staff:<email>' (the shop). Read and
-- written only by the server (RLS on, no policies). Removing sets removed_at; nothing is deleted.
create table if not exists public.sheet_layouts (
  id uuid primary key default gen_random_uuid(),
  owner text not null,
  name text not null default '',
  data jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists sheet_layouts_owner_idx on public.sheet_layouts (owner, removed_at);
alter table public.sheet_layouts enable row level security;
