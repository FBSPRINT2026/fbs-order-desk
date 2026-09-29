-- (049) Printavo sync status: estimates per year from order numbers while the full pass runs.
-- Printavo sync status: how many orders Printavo says it has (sum of each customer's order count), where the full
-- pass is (customer N of M), and orders found / imported per year so a hole shows up right away.
create or replace function public.printavo_sync_status()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public', 'storage'
as $function$
  select case when not public.is_staff() then null else jsonb_build_object(
    'enabled', s.enabled, 'sweep_no', s.sweep_no, 'sweep_started_at', s.sweep_started_at, 'sweep_done_at', s.sweep_done_at,
    'customers_done_at', s.customers_done_at, 'last_run_at', s.last_run_at, 'last_error', s.last_error, 'last_error_at', s.last_error_at,
    'listing', s.sweep_no = 0,
    'orders', (select count(*) from printavo_index where status <> 'gone'),
    'pending', (select count(*) from printavo_index where status = 'pending'),
    'new_waiting', (select count(*) from printavo_index where status = 'pending' and archived_id is null),
    'have', (select count(*) from printavo_index where status <> 'gone' and archived_id is not null),
    'files_waiting', (select count(*) from printavo_index where status = 'files'),
    'done', (select count(*) from printavo_index where status = 'done'),
    'errors', (select count(*) from printavo_index where status = 'error'),
    'gone', (select count(*) from printavo_index where status = 'gone'),
    'customers', (select count(*) from printavo_customers),
    'expected', (select coalesce(sum(nullif(data->>'orderCount', '')::int), 0) from printavo_customers),
    'pass_customer', case when s.sweep_cursor like 'c:%' then (select count(*) from printavo_customers c where c.printavo_id < substring(s.sweep_cursor from 'c:([^|]*)')) end,
    'files_total', (select coalesce(sum(files_total), 0) from archived_orders),
    'files_copied', (select coalesce(sum(files_copied), 0) from archived_orders),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'proofs'),
    'oldest_done', (select min(created_at) from printavo_index where status in ('done','files')),
    'last_hour', (select count(*) from printavo_index where imported_at > now() - interval '1 hour'),
    -- per year: found / imported, and about how many Printavo has (from the order numbers used that year) until a full
    -- customer-by-customer pass has finished (pass 12 was the first); after that, what we found is the count
    'by_year', (select coalesce(jsonb_agg(jsonb_build_object('year', y.year, 'found', y.found, 'imported', y.imported,
        'est', case when s.sweep_no >= 12 or y.year = (select min(extract(year from created_at))::int from printavo_index where created_at is not null) then y.found
                    when coalesce(y.next_lo - y.lo, y.hi - y.lo + 1, 0) > y.found * 1.25 then coalesce(y.next_lo - y.lo, y.hi - y.lo + 1)
                    else y.found end) order by y.year), '[]'::jsonb)
      from (select p.*, lead(p.lo) over (order by p.year) as next_lo from (
        select extract(year from created_at)::int as year, count(*) as found, count(*) filter (where archived_id is not null) as imported,
          percentile_disc(0.01) within group (order by case when visual_id ~ '^\d{1,6}$' then visual_id::bigint end) as lo,
          percentile_disc(0.99) within group (order by case when visual_id ~ '^\d{1,6}$' then visual_id::bigint end) as hi
        from printavo_index where status <> 'gone' and created_at is not null group by 1) p) y),
    'recent_errors', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select visual_id, error from printavo_index where status = 'error' order by imported_at desc nulls last limit 8) e)
  ) end from printavo_sync s where s.id = 1;
$function$;
