-- uAttend API sync (read-only from uAttend): punches land in time_punches (source 'uattend', uattend_id 'ua:<id>:in|out').
-- One status row for the pages (last run / success / error, what the last run did).
create table if not exists public.uattend_sync (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  users_at timestamptz,
  last_summary jsonb
);
insert into public.uattend_sync (id) values (1) on conflict do nothing;
alter table public.uattend_sync enable row level security;
drop policy if exists uattend_sync_staff_read on public.uattend_sync;
create policy uattend_sync_staff_read on public.uattend_sync for select using (public.is_staff());

-- Every 2 minutes from 5 AM to 8 PM shop time (who's in drives when each press crew's day starts), every 30 minutes
-- otherwise. After an error (including "no key yet") it waits 10 minutes before trying again.
create or replace function public.uattend_sync_tick() returns void language plpgsql security definer set search_path = public, extensions as $$
declare s record; t uuid; h int;
begin
  select * into s from uattend_sync where id = 1;
  if s is null or not s.enabled then return; end if;
  if s.last_error_at is not null and s.last_error_at > now() - interval '10 minutes' then return; end if;
  h := extract(hour from now() at time zone 'America/Chicago');
  if not (h between 5 and 19) and extract(minute from now())::int % 30 >= 2 then return; end if;
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/time/uattend', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
end $$;
revoke all on function public.uattend_sync_tick() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'uattend-sync';
select cron.schedule('uattend-sync', '*/2 * * * *', $$select public.uattend_sync_tick()$$);
