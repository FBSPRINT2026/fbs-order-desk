-- The time clock watch (Nov 4, Nick): offline 5+ minutes → an alert to the owner; back → another. Every minute.
-- (applied as migration 283_clock_watch; see components/ClockStatus.tsx for the Payroll Center's status)
alter table public.timeclock_devices add column if not exists offline_since timestamptz, add column if not exists offline_alerted_at timestamptz;
-- function public.clock_watch_tick() and cron job 'clock-watch' ('* * * * *'): see the applied migration
