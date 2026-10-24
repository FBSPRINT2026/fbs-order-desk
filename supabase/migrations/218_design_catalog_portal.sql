-- The design catalog shown to the customer in their portal too (Artwork → Design catalog), when staff turn it on (Oct 24, Nick)
alter table public.customers add column if not exists design_catalog_portal boolean not null default false;
