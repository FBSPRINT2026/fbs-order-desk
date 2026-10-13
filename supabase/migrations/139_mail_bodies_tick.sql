-- The slow lane for emails kept without a body (Oct 13): /api/mail/bodies every 5 minutes, up to 4 minutes.
create or replace function public.mail_bodies_tick() returns void language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare t uuid;
begin
  if not exists (select 1 from mail_accounts where enabled) then return; end if;
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/mail/bodies', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 300000);
end $$;
select cron.schedule('mail-bodies', '3-58/5 * * * *', 'select public.mail_bodies_tick()');
