-- Separo jobs read from the shop's Separo account: each job's ladder of ink choices (1..9 colors), the count Separo
-- picked by default and any custom palette. Learning data for how Separo limits colors (Nick, Nov 23 2026).
create table if not exists separo_jobs (
  id bigint primary key,
  ref text default '',
  state text default '',
  created date,
  picked int,
  palettes jsonb not null default '[]',
  imported_at timestamptz default now()
);
alter table separo_jobs enable row level security;
