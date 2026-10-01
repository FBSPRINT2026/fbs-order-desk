-- the biggest file the Printavo copier takes (MB). Supabase's project-wide upload limit is 50 MB unless the owner raises it
-- (Storage → Settings); raise this to match, then "Try big files again" on the Import page.
alter table public.printavo_sync add column if not exists max_file_mb integer not null default 45;
