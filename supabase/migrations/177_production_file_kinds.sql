-- What a production file is (Oct 20, Nick): barcodes / labels, mailing list, film / separations, … (lib/productionFileKinds.ts).
-- Staff only like the rest of art_files. Additive.
alter table public.art_files add column if not exists category text;
comment on column public.art_files.category is 'What the production file is: a key from lib/productionFileKinds.ts (barcodes, mailing, film, …); null = not labeled yet';
create index if not exists art_files_category on public.art_files (category) where category is not null;
