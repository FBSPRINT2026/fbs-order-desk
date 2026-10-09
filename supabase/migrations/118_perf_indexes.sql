-- Speed pass (Oct 2026): the dashboard, search and order lists were slow to come up.
-- Already applied to the live database; this file records it. Every statement is safe to run again.

-- 1. Row security: ask "is this person staff?" once per query, not once per row.
--    The staff policies said `using (is_staff())`. Postgres ran that check for every row it looked at, so reading the
--    23k-job Printavo archive meant 23k staff lookups (the dashboard's open balances took 5.1 s; 0.2 s after this).
--    `(select is_staff())` is the same rule, worked out once at the start of the query.
do $$
declare p record; sql text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'public'
             and coalesce(qual, 'is_staff()') = 'is_staff()'
             and coalesce(with_check, 'is_staff()') = 'is_staff()'
             and (qual is not null or with_check is not null)
  loop
    sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if p.qual is not null then sql := sql || ' using ((select public.is_staff()))'; end if;
    if p.with_check is not null then sql := sql || ' with check ((select public.is_staff()))'; end if;
    execute sql;
  end loop;
end $$;
-- same for the settings read rule (one row, but the database's own advisor flags it)
alter policy settings_read on public.settings using ((select auth.role()) = 'authenticated');

-- 2. Indexes on the Printavo archive for what the shop pages filter and sort by.
-- dashboard / orders / shipping lists: by due date, and the jobs still open
create index if not exists archived_orders_due_idx on public.archived_orders (due_date);
create index if not exists archived_orders_open_idx on public.archived_orders (due_date)
  where status_name not in ('Job Completed', 'Quote - Closed');
-- shipping center: Printavo jobs waiting to ship
create index if not exists archived_orders_ready_ship_idx on public.archived_orders (due_date)
  where status_name ilike '%ready to ship%';
-- dashboard: open balances, ordered-this-time-last-year, account owners from recent orders; sales charts
create index if not exists archived_orders_kind_balance_idx on public.archived_orders (kind, balance);
create index if not exists archived_orders_kind_order_date_idx on public.archived_orders (kind, order_date);
create index if not exists archived_orders_order_date_idx on public.archived_orders (order_date);
-- projects: the Printavo jobs on a project
create index if not exists archived_orders_project_idx on public.archived_orders (project_id) where project_id is not null;

-- 3. Text search over the Printavo archive (Search page, Orders page search box).
--    The text index (archived_orders_search_idx) can't be used by a filter sent from the browser: under row security
--    Postgres won't use an `ilike` as an index lookup, so every search read all 23k jobs. This staff-only function
--    runs the same search with the index (a rare word: ~2 ms instead of ~300 ms+).
--    Every word must appear; the first word is the one looked up in the index (callers put the longest first).
create or replace function public.search_archived_orders(p_words text[], p_limit int default 25)
returns setof public.archived_orders
language sql stable security definer set search_path = public as $$
  select a.*
  from public.archived_orders a
  where (select public.is_staff())
    and coalesce(array_length(p_words, 1), 0) > 0
    and a.search_staff ilike '%' || p_words[1] || '%'
    and not exists (select 1 from unnest(p_words[2:]) w where a.search_staff not ilike '%' || w || '%')
  order by a.order_date desc nulls last
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
$$;
revoke execute on function public.search_archived_orders(text[], int) from public, anon;
grant execute on function public.search_archived_orders(text[], int) to authenticated, service_role;

-- Note (Oct 9, 2026, QuickBooks review): the live database has two search_archived_orders functions:
-- search_archived_orders(p_words text[], p_limit integer), the current one, and an older
-- search_archived_orders(p_q text, p_limit integer) left from before. The older one is unused; it's recorded here
-- and deliberately not dropped.
