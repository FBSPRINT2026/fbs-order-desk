-- A note on each production file, and what the AI thinks it is (shown for staff to confirm). Additive. (Oct 20, Nick)
alter table public.art_files add column if not exists note text;
alter table public.art_files add column if not exists guess text;
comment on column public.art_files.note is 'A note on the production file, e.g. "Amazon barcodes for The Bottles"';
comment on column public.art_files.guess is 'What the AI thinks the file is (a lib/productionFileKinds.ts key, or "?" = looked, no idea): shown for staff to confirm, never used as the label by itself';
