-- Goods pass (tracking + rules + AI recommendations) hourly, Mon–Fri 6 a.m.–6 p.m. Central (already applied).
create or replace function public.goods_track_tick()
 returns void language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare t uuid; here timestamp := now() at time zone 'America/Chicago';
begin
  if extract(isodow from here) > 5 or extract(hour from here) < 6 or extract(hour from here) > 18 then return; end if;
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/goods/ai-match', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 300000);
end $function$;
select cron.alter_job((select jobid from cron.job where jobname = 'goods-track'), schedule := '0 * * * *');
