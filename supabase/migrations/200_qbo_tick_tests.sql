-- QuickBooks test mode (Oct 24): while the sync is off, the every-minute tick still runs when a test invoice's order
-- has a change waiting, so test invoices follow their orders (lib/qbo/runner.ts followTests). Nothing else is sent.
create or replace function public.qbo_sync_tick() returns void
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare s record; connected boolean; tests boolean;
begin
  select enabled, token, keepalive_at into s from qbo_settings where id = 1;
  if s is null then return; end if;
  if not s.enabled then
    select coalesce((data->>'realm_id') <> '', false) into connected from integration_tokens where name = 'quickbooks';
    if not coalesce(connected, false) then return; end if;
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
