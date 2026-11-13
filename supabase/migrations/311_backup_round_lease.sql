-- one backup round at a time (Nov 12 night: two rounds of the same backup ran together and one saved its list of
-- finished tables over the other's, so the manifest lost 65 tables). A round claims the backup until this time.
alter table public.data_backups add column if not exists round_until timestamptz;
