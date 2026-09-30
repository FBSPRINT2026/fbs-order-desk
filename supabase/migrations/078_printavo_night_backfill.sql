-- The rest of 2023 (~1,500 orders never imported) comes over after hours: the order sync runs every minute from 7 PM
-- to 6 AM shop time (00–10 UTC in daylight time) and every 2 minutes during the day. The sync itself only picks up
-- those older orders after hours (app/api/printavo/sync). Once 2023 is complete, nothing older than 30 days is read again.
select cron.alter_job(jobid, schedule := '*/2 11-23 * * *') from cron.job where jobname = 'printavo-sync-api';
select cron.schedule('printavo-sync-api-night', '* 0-10 * * *', $$select public.printavo_sync_tick('api')$$);
