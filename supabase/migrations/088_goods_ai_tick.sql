-- The AI goods matcher (/api/goods/ai-match) runs right after the rules pass, every 20 minutes (already applied).
create or replace function public.goods_track_tick()
 returns void language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
declare t uuid;
begin
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/goods/track', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
  perform net.http_get(url := 'https://portal.fbsprint.com/api/goods/ai-match', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 300000);
end $function$;
