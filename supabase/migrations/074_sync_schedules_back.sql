-- Sep 29, 9:15 PM: the database was healthy again, so the syncs went back to every minute (Nicholas's call).
-- The lighter Printavo sync stays (full pass every 6 hours, active-jobs check every 10 minutes), which keeps the
-- write load well below what took the database down.
select cron.alter_job(jobid, schedule := '* * * * *', active := true)
from cron.job where jobname in ('printavo-sync-api', 'printavo-sync-files-1', 'printavo-sync-files-2', 'sanmar-sync');
