-- Brand standards shown in the customer's portal (on by default, as before); staff can turn it off (Oct 24, Nick)
alter table public.customers add column if not exists brand_portal boolean not null default true;
