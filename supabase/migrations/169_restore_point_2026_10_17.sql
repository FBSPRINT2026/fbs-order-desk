-- Restore point (Oct 17, 2026, 7:55 AM CT, Nick): a copy of every public table as it was, in schema restore_20261017
-- (not visible to the app or the API). Left out: caches that rebuild themselves (mail_cache, mail_index,
-- archived_orders, printavo_file_names, printavo_index, printavo_sync_locks, mail_ews_ids, sanmar_styles,
-- ship_transit_zip3, text_messages). Code: branch restore-2026-10-17 (commit 6c2e4c1), Vercel dpl_FKeGbnwYXfRZ8h4WiUwcEZED7BFp.
create schema if not exists restore_20261017;
revoke all on schema restore_20261017 from public, anon, authenticated;
do $$
declare t text;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r'
             and c.relname not in ('mail_cache','mail_index','archived_orders','printavo_file_names','printavo_index','printavo_sync_locks','mail_ews_ids','sanmar_styles','ship_transit_zip3','text_messages')
  loop
    execute format('create table if not exists restore_20261017.%I as table public.%I', t, t);
  end loop;
end $$;
revoke all on all tables in schema restore_20261017 from public, anon, authenticated;
