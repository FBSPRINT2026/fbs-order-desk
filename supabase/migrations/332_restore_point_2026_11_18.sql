-- Restore point (Nov 18, 2026, 4:29 PM CT, Nick: "back up the database right now before we start editing old QuickBooks
-- or Printavo stuff"): a copy of every public table as it was, in schema restore_20261118 (not visible to the app or the
-- API), taken just before Edit here (1.3.742) was first used. This time archived_orders (every Printavo job) is
-- included. Left out: caches that rebuild themselves (mail_cache, mail_index, printavo_file_names, printavo_index,
-- printavo_sync_locks, mail_ews_ids, sanmar_styles, ship_transit_zip3, text_messages). Already run on the database;
-- kept here as the record. Checked: archived_orders 23,657, orders 520, payments 206, customers 660, qbo_links 465.
create schema if not exists restore_20261118;
revoke all on schema restore_20261118 from public, anon, authenticated;
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and c.relname not in ('mail_cache','mail_index','printavo_file_names','printavo_index','printavo_sync_locks','mail_ews_ids','sanmar_styles','ship_transit_zip3','text_messages')
  loop
    execute format('create table if not exists restore_20261118.%I as table public.%I', t, t);
  end loop;
end $$;
revoke all on all tables in schema restore_20261118 from public, anon, authenticated;
