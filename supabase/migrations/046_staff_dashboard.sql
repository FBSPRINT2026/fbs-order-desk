-- Each admin's own dashboard: which widgets, in what order, how wide/tall, plus their sticky note
alter table public.staff add column if not exists dashboard jsonb;
