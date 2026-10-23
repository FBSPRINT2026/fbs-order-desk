-- The Thread Room (Oct 23, Nick: "just like we have the ink room, we need to have the thread room… its little logo can be
-- a spool"): the embroidery threads the shop keeps on the wall, Madeira first (Polyneon 40, Classic Rayon 40), with how
-- many cones and where. The Mockup Creator puts a thread we stock first when it's about as close. Archived, never deleted.
create table if not exists public.stock_threads (
  id uuid primary key default gen_random_uuid(),
  brand text not null default 'Madeira',
  line text not null default 'Polyneon 40',
  code text not null,
  name text not null default '',
  hex text not null default '',
  pms text not null default '',
  cones integer,
  min_cones integer,
  spot text not null default '',
  notes text not null default '',
  archived_at timestamptz,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists stock_threads_code_idx on public.stock_threads (brand, line, code) where archived_at is null;
alter table public.stock_threads enable row level security;
create policy stock_threads_staff on public.stock_threads for all using (public.is_staff()) with check (public.is_staff());
