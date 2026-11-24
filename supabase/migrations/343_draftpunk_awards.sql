-- DraftPunk: the club's trophy case (Nick, Nov 24 2026: the AHA gave him the Ninkasi Award artwork to use as a winner).
-- An award's picture is the file the club was given, uploaded by a club admin and kept here, never in the site's code
-- (the repository is public). Members see it inside DraftPunk: the trophy case on Competitions, and beside entries
-- whose result is that award.
create table if not exists dp_awards (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  year int,
  place text not null default '' check (place in ('', 'gold', 'silver', 'bronze', 'hm', 'bos', 'ninkasi')),
  image text not null default '',
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table dp_awards enable row level security;
create policy dp_awards_read on dp_awards for select using (dp_is_brewer());
-- written by the server for club admins (addAward / removeAward)
