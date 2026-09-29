-- A test account (e.g. "ABC Test Company"): sample jobs can be added to it and cleared from its page.
alter table public.customers add column if not exists is_test boolean not null default false;
