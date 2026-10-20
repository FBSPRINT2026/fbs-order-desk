-- Whether someone takes a lunch break (Oct 20, 2026, Nick: "some people take lunches, some don't… Arturo never takes a
-- lunch because he doesn't work a long enough day"). Off = never listed for a missing lunch on the time clock.
alter table public.employees add column if not exists takes_lunch boolean not null default true;
