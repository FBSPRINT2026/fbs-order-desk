-- What actually ran on press, per print location, next to the suggested setup (the separation's press setup):
-- the press, each head in order (screen / flash / cool / empty) with its ink and mesh, notes, and the differences
-- from the suggestion. Saved from the job's phone menu by the crew. The newest row per location is "as printed";
-- when `learned`, its changes were also written into the separation, the design and the order's inks, so a reorder
-- starts from what really printed.
create table if not exists public.press_actuals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  archived_order_id uuid references public.archived_orders(id) on delete cascade,
  separation_id uuid references public.separations(id) on delete set null,
  location text not null default '',
  press_id text not null default '',
  press_name text not null default '',
  -- [{ what: 'screen'|'flash'|'cool'|'empty', key?, name, hex, mesh }]
  heads jsonb not null default '[]'::jsonb,
  -- [{ kind: 'press'|'ink'|'mesh'|'order'|'flash', text }]
  changes jsonb not null default '[]'::jsonb,
  notes text not null default '',
  learned boolean not null default false,
  by_name text not null default '',
  by_email text not null default '',
  employee_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists press_actuals_order_idx on public.press_actuals (order_id, created_at desc);
create index if not exists press_actuals_archived_idx on public.press_actuals (archived_order_id, created_at desc);
create index if not exists press_actuals_sep_idx on public.press_actuals (separation_id, created_at desc);
alter table public.press_actuals enable row level security;
drop policy if exists press_actuals_staff on public.press_actuals;
create policy press_actuals_staff on public.press_actuals for all using (public.is_staff()) with check (public.is_staff());
