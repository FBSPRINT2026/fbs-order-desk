-- Every set of films made for a print, and the one that went on press (Nick, Nov 23 2026: "we're not logging what we
-- actually were able to use… I don't know if we used your version of the film or we went and got Separo"). One row per
-- try: who made it (our Studio, Separo, Illustrator by hand, the customer's), whether it printed right (and what was
-- wrong), the files, and which one was used on press. Learned from every night (/api/cron/sep-coach).
create table if not exists sep_films (
  id uuid primary key default gen_random_uuid(),
  separation_id uuid not null references separations(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  made_by text not null default 'studio',
  result text not null default 'pending',
  problems text[] not null default '{}',
  note text not null default '',
  files jsonb not null default '[]'::jsonb,
  dropbox text not null default '',
  used boolean not null default false,
  width_in numeric, height_in numeric, colors int, method text,
  by text not null default '',
  created_at timestamptz not null default now(),
  checked_at timestamptz, checked_by text,
  snooze_until timestamptz,
  learned_at timestamptz
);
create index if not exists sep_films_sep on sep_films (separation_id, created_at desc);
create index if not exists sep_films_pending on sep_films (by, result) where result = 'pending';
alter table sep_films enable row level security;
