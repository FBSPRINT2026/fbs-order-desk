-- Printavo is gone (Nick, Nov 15 2026: "remove all the Printavo sync features… only thing I wanna keep is a little P next
-- to the invoice that signify it was made in that system"). Printavo closed our account on Nov 14; its API has answered
-- "Account does not have API access" since. Everything it had up to Nov 13 3:28 PM is in archived_orders, its files in
-- our storage.
-- The Printavo schedules stop. printavo_sync stays: its token is the shared key the other server jobs use.
do $$
declare j text;
begin
  foreach j in array array['printavo-sync-api', 'printavo-sync-api-night', 'printavo-sync-files-1', 'printavo-sync-files-2', 'printavo-payment-watch'] loop
    if exists (select 1 from cron.job where jobname = j) then perform cron.unschedule(j); end if;
  end loop;
end $$;

update printavo_sync set enabled = false, updated_at = now() where id = 1;
