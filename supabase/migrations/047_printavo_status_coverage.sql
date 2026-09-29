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
    'by_year', (select coalesce(jsonb_agg(y order by y.year), '[]'::jsonb) from (
        select extract(year from created_at)::int as year, count(*) as found, count(*) filter (where archived_id is not null) as imported
        from printavo_index where status <> 'gone' and created_at is not null group by 1) y),
    'recent_errors', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select visual_id, error from printavo_index where status = 'error' order by imported_at desc nulls last limit 8) e)
  ) end from printavo_sync s where s.id = 1;
$function$;
