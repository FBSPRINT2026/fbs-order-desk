-- "theMcKennagroup", "The McKenna Group, LLC" and "the  mckenna group" are the same company (same rule as lib/printavoImport.ts companyKey)
create or replace function public.company_key(name text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    replace(lower(coalesce(name, '')), '&', ' and '),
    '[^a-z0-9]+', ' ', 'g'),
    '\m(inc|llc|ltd|co|corp|corporation|company|pllc|pc)\M', ' ', 'g'),
    '^\s*the', ''),
    '\s+', '', 'g')
$$;
alter table public.customers add column if not exists company_key text generated always as (public.company_key(company)) stored;
create index if not exists customers_company_key_idx on public.customers (company_key);
