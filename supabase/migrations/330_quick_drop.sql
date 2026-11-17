-- Portal Quick Drop (Nov 17, Amanda): a request to bring in a folder of the shared "Portal Quick Drop" Dropbox folder
-- (lib/quickDrop.ts). Added by Claude or staff; run by /api/quick-drop, which quick_drop_tick calls while one waits.
create table if not exists quick_drops (
  id bigserial primary key,
  folder text not null default '',
  customer_id uuid references customers(id),
  order_id uuid references orders(id) on delete set null,
  plan jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  result jsonb,
  error text,
  requested_by text not null default '',
  created_at timestamptz not null default now(),
  started_at timestamptz,
  done_at timestamptz
);
alter table quick_drops enable row level security;
drop policy if exists quick_drops_staff on quick_drops;
create policy quick_drops_staff on quick_drops for all to authenticated using (is_staff()) with check (is_staff());

create or replace function quick_drop_tick() returns void language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  -- a run stuck over 10 minutes goes back in line
  update quick_drops set status = 'pending' where status = 'running' and started_at < now() - interval '10 minutes';
  if not exists (select 1 from quick_drops where status = 'pending') then return; end if;
  select token::text into t from printavo_sync where id = 1;
  if t is null then return; end if;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/quick-drop', headers := jsonb_build_object('x-sync-token', t), timeout_milliseconds := 300000);
end $$;

select cron.unschedule('quick-drop') where exists (select 1 from cron.job where jobname = 'quick-drop');
select cron.schedule('quick-drop', '* * * * *', 'select public.quick_drop_tick()');
