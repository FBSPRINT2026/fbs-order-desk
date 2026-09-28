-- Customer supplied goods: refresh inbound tracking and send goods alerts every 20 minutes (see app/api/goods/track).
create or replace function public.goods_track_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare t uuid;
begin
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/goods/track', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
end $$;
revoke execute on function public.goods_track_tick() from public, anon, authenticated;
select cron.unschedule(jobname) from cron.job where jobname = 'goods-track';
select cron.schedule('goods-track', '*/20 * * * *', $$select public.goods_track_tick()$$);
