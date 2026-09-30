-- Sep 29: the database ran out of headroom (a small compute plan under non-stop sync writes) and the portal went down
-- for ~35 minutes. The syncs now run less often (applied live the same night):
--   Printavo orders every 2 minutes, the two Printavo file copiers every 5 (staggered), SanMar every 5.
select cron.alter_job(jobid, schedule := s, active := true)
from (values ('printavo-sync-api', '*/2 * * * *'), ('printavo-sync-files-1', '*/5 * * * *'), ('printavo-sync-files-2', '2-59/5 * * * *'), ('sanmar-sync', '4-59/5 * * * *')) v(n, s)
join cron.job j on j.jobname = v.n;
