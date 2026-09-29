-- SanMar's whole catalog as a searchable style list (SanMar has no search call, so we keep our own index).
-- Filled by /api/sanmar/sync, which the database's schedule calls every minute while there's work to do:
-- the list of sellable styles is refreshed weekly, each style's details (brand, name, colors, sizes, photo) monthly.
-- Prices aren't kept here: picking a style pulls it into the garment catalog with our live SanMar price.
create table if not exists sanmar_styles (
  style text primary key,              -- SanMar style # as SanMar writes it (PC61, K500, NKDC1963)
  brand text not null default '',
  title text not null default '',
  category text not null default '',
  image text not null default '',
  colors text[] not null default '{}',
  sizes text[] not null default '{}',
  status text not null default '',
  sellable boolean not null default true,
  listed_at timestamptz,               -- last time it was on SanMar's sellable list
  detail_at timestamptz,               -- last time details were read (null = not yet)
  detail_error text,
  updated_at timestamptz not null default now()
);
create index if not exists sanmar_styles_detail on sanmar_styles (detail_at nulls first) where sellable;
alter table sanmar_styles enable row level security;
drop policy if exists sanmar_styles_staff on sanmar_styles;
create policy sanmar_styles_staff on sanmar_styles for select using (is_staff());

create table if not exists sanmar_sync (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  list_at timestamptz,
  list_count int not null default 0,
  last_run_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  running_until timestamptz
);
insert into sanmar_sync (id) values (1) on conflict do nothing;
alter table sanmar_sync enable row level security;
drop policy if exists sanmar_sync_staff on sanmar_sync;
create policy sanmar_sync_staff on sanmar_sync for select using (is_staff());

-- one run at a time
create or replace function public.sanmar_sync_claim(p_seconds int) returns boolean language plpgsql security definer set search_path = public as $$
begin
  update sanmar_sync set running_until = now() + make_interval(secs => p_seconds)
   where id = 1 and (running_until is null or running_until < now());
  return found;
end $$;
revoke all on function public.sanmar_sync_claim(int) from public, anon, authenticated;

-- the schedule: call the server only while something is due (same token as the Printavo sync)
create or replace function public.sanmar_sync_tick() returns void language plpgsql security definer set search_path = public, extensions as $$
declare s record; t uuid;
begin
  select * into s from sanmar_sync where id = 1;
  if not s.enabled then return; end if;
  -- after a failed run, wait 10 minutes before trying again
  if s.last_error_at is not null and s.last_error_at > now() - interval '10 minutes' then return; end if;
  if s.list_at is not null and s.list_at > now() - interval '7 days'
     and not exists (select 1 from sanmar_styles where sellable and (detail_at is null or detail_at < now() - interval '30 days')) then
    return;
  end if;
  select token into t from printavo_sync where id = 1;
  perform net.http_get(url := 'https://portal.fbsprint.com/api/sanmar/sync', headers := jsonb_build_object('x-sync-token', t::text), timeout_milliseconds := 65000);
end $$;
revoke all on function public.sanmar_sync_tick() from public, anon, authenticated;

select cron.unschedule(jobname) from cron.job where jobname = 'sanmar-sync';
select cron.schedule('sanmar-sync', '* * * * *', $$select public.sanmar_sync_tick()$$);
