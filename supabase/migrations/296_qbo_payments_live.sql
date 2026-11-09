-- Portal payments to QuickBooks every hour (Nov 9, Nick: "mark them in real time as they get paid… every hour on the
-- hour, just sync"). With payments_live on, payments go to QuickBooks even while the rest of the sync is off: the tick
-- calls the runner with ?payments=1 at most once an hour when a payment is waiting (lib/qbo/push.ts chargePayment).
alter table public.qbo_settings add column if not exists payments_live boolean not null default false;
alter table public.qbo_settings add column if not exists payments_run_at timestamptz;

create or replace function public.qbo_sync_tick() returns void
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare s record; connected boolean; tests boolean; pays boolean;
begin
  select enabled, token, keepalive_at, payments_live, payments_run_at into s from qbo_settings where id = 1;
  if s is null then return; end if;
  if not s.enabled then
    select coalesce((data->>'realm_id') <> '', false) into connected from integration_tokens where name = 'quickbooks';
    if not coalesce(connected, false) then return; end if;
    -- payments only, at most once an hour, when one is waiting
    if s.payments_live and (s.payments_run_at is null or s.payments_run_at < now() - interval '55 minutes') then
      select exists (select 1 from qbo_queue where entity = 'payment' and status = 'pending' and run_after <= now()) into pays;
      if pays then
        update qbo_settings set payments_run_at = now() where id = 1;
        perform net.http_get(
          url := 'https://portal.fbsprint.com/api/qbo/sync?payments=1',
          headers := jsonb_build_object('x-sync-token', s.token::text),
          timeout_milliseconds := 300000);
        return;
      end if;
    end if;
    select exists (
      select 1 from qbo_queue q join qbo_links l on l.entity = 'invoice' and l.local_id = q.local_id and l.source = 'test'
      where q.entity = 'invoice' and q.status in ('pending', 'error') and q.run_after <= now()
    ) into tests;
    if not tests and s.keepalive_at is not null and s.keepalive_at > now() - interval '20 hours' then return; end if;
  end if;
  perform net.http_get(
    url := 'https://portal.fbsprint.com/api/qbo/sync',
    headers := jsonb_build_object('x-sync-token', s.token::text),
    timeout_milliseconds := 300000);
end $$;
