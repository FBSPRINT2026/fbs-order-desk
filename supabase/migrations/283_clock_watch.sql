-- The time clock watch (Nov 4, Nick: "if it sees it going offline, like more than 5 minutes, it sends up a
-- notification"). Every minute: a clock that hasn't checked in for 5 minutes gets one alert to the owner (once per
-- outage), and another when it's back. The Payroll Center shows it live (components/ClockStatus.tsx).
alter table public.timeclock_devices add column if not exists offline_since timestamptz, add column if not exists offline_alerted_at timestamptz;

create or replace function public.clock_watch_tick() returns void language plpgsql security definer set search_path to 'public' as $$
declare d record; who text;
begin
  for d in select id, name, last_seen_at, offline_since, offline_alerted_at from timeclock_devices where active and kind = 'zk' loop
    if d.last_seen_at is null or d.last_seen_at < now() - interval '5 minutes' then
      if d.offline_alerted_at is null then
        update timeclock_devices set offline_since = coalesce(d.last_seen_at, now()), offline_alerted_at = now() where id = d.id;
        for who in select lower(email) from staff where role = 'owner' loop
          insert into alerts (owner, kind, title, body, url, dedupe_key)
          values (who, 'clock', 'The time clock is offline',
            'It last checked in at ' || to_char(coalesce(d.last_seen_at, now()) at time zone 'America/Chicago', 'FMHH12:MI AM') || '. Punches stay on the clock and upload when it''s back. Check its network cable, or restart it.',
            '/shop/payroll', 'clock-offline:' || d.id || ':' || extract(epoch from now())::bigint)
          on conflict (dedupe_key) do nothing;
        end loop;
      end if;
    elsif d.offline_alerted_at is not null then
      for who in select lower(email) from staff where role = 'owner' loop
        insert into alerts (owner, kind, title, body, url, dedupe_key)
        values (who, 'clock', 'The time clock is back online',
          'It was offline from ' || to_char(d.offline_since at time zone 'America/Chicago', 'FMHH12:MI AM') || ' to ' || to_char(d.last_seen_at at time zone 'America/Chicago', 'FMHH12:MI AM') || '. Punches made in between are coming in now.',
          '/shop/payroll', 'clock-online:' || d.id || ':' || extract(epoch from now())::bigint)
        on conflict (dedupe_key) do nothing;
      end loop;
      update timeclock_devices set offline_since = null, offline_alerted_at = null where id = d.id;
    end if;
  end loop;
end $$;
revoke execute on function public.clock_watch_tick() from anon, authenticated;
select cron.schedule('clock-watch', '* * * * *', 'select public.clock_watch_tick()');
