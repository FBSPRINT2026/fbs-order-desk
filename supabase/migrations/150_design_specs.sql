-- what production confirmed about how a design prints (location, size, drop, inks, colors, underbase), with every
-- confirmation kept (history), so the next reorder repeats it. Only production confirmations write here, never guesses.
alter table designs add column if not exists specs jsonb not null default '{}'::jsonb;
