-- Sep 30: the Printavo sync was re-importing ~500 unchanged orders an hour (the database's heaviest write) and took
-- the portal down twice. Now it only imports / refreshes orders created in the last 30 days, and skips the save when
-- an order hasn't changed (data_hash). The ~1,500 older orders queued for re-import are left as they are.
alter table archived_orders add column if not exists data_hash text;
update printavo_index set status = 'done' where status = 'pending' and archived_id is not null and created_at < now() - interval '30 days';
update printavo_sync set sweep_cursor = null, sweep_started_at = null where id = 1;
