-- Printavo sync: every 5 minutes the active jobs (latest due dates first) are checked for changes
alter table public.printavo_sync add column if not exists quick_cursor text;
alter table public.printavo_sync add column if not exists quick_pages integer not null default 0;
alter table public.printavo_sync add column if not exists quick_done_at timestamptz;
-- when Printavo asks us to slow down (or staff import a customer by hand) the background sync waits until this time
alter table public.printavo_sync add column if not exists pause_until timestamptz;
