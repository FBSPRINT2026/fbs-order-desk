-- Searchable text for archived orders. search_text is what a customer may search (no production notes);
-- search_staff adds the shop-only parts. HTML from Printavo notes is stripped.
create or replace function public.archive_search_text(d jsonb, staff boolean) returns text
language sql immutable set search_path = public as $$
  select lower(regexp_replace(regexp_replace(concat_ws(' ',
    d->>'visualId', d->>'nickname', d->>'poNumber', d->'status'->>'name', d->>'customerNote',
    (select string_agg(concat_ws(' ', l->>'category', l->>'itemNumber', l->>'color', l->>'description', l->>'brand',
        (select string_agg(concat_ws(' ', p->>'name', p->>'value'), ' ') from jsonb_array_elements(coalesce(l->'personalizations','[]'::jsonb)) p)), ' ')
       from jsonb_array_elements(coalesce(d->'groups','[]'::jsonb)) g, jsonb_array_elements(coalesce(g->'lines','[]'::jsonb)) l),
    (select string_agg(concat_ws(' ', i->>'typeOfWork', i->>'details', i->>'column'), ' ')
       from jsonb_array_elements(coalesce(d->'groups','[]'::jsonb)) g, jsonb_array_elements(coalesce(g->'imprints','[]'::jsonb)) i),
    (select string_agg(f->>'description', ' ') from jsonb_array_elements(coalesce(d->'fees','[]'::jsonb)) f),
    case when staff then concat_ws(' ', d->>'productionNote', d->>'owner',
      (select string_agg(x, ' ') from jsonb_array_elements_text(coalesce(d->'tags','[]'::jsonb)) x),
      (select string_agg(f->>'name', ' ') from jsonb_array_elements(coalesce(d->'files','[]'::jsonb)) f),
      (select string_agg(t->>'name', ' ') from jsonb_array_elements(coalesce(d->'tasks','[]'::jsonb)) t)) end
  ), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g'))
$$;
alter table public.archived_orders add column if not exists search_text text generated always as (public.archive_search_text(data, false)) stored;
alter table public.archived_orders add column if not exists search_staff text generated always as (public.archive_search_text(data, true)) stored;
create extension if not exists pg_trgm;
create index if not exists archived_orders_search_idx on public.archived_orders using gin (search_staff gin_trgm_ops);
