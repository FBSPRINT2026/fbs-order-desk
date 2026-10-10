-- The original names of the files we copied from Printavo (Oct 10, 2026). Nick: "the files you brought in from Printavo
-- lost their naming… when I go to download it's got some random name."
-- Printavo's API only gave Filestack (filepicker) links, never the mockups' names; Filestack's public metadata endpoint
-- (https://www.filestackapi.com/api/file/<handle>/metadata) has the original file name. Names are kept here, by
-- Filestack handle, because archived_orders before 2026 and their copied files are locked (migration 082): nothing in
-- archived_orders or storage is changed. /api/printavo/file-names fills this table; pages show and download files
-- under these names (Supabase signed links with download=<name>).
-- Additive only; safe to run again.

create table if not exists public.printavo_file_names (
  handle text primary key,                 -- the Filestack handle (20 characters), e.g. lrB1LIIdSTKa0J6EyNfD
  filename text,                           -- the original name, e.g. "Peticolas Sit Down Forest.pdf"
  mimetype text,
  size bigint,
  status text check (status in ('ok', 'missing', 'error', 'working')),  -- null = waiting to be looked up
  tries integer not null default 0,
  last_error text,
  priority smallint not null default 0,    -- new orders already made from old Printavo jobs (reorders): their production files were labelled
-- "From the old Printavo job: Printavo #33729.pdf"; they get the file's real name ("From the old Printavo job #33729:
-- Peticolas Sit Down Forest.pdf"). Only art_files.name changes (orders.groups is left alone: changing it would resend
-- the invoice to QuickBooks). Safe to run again; returns how many were renamed.
create or replace function public.printavo_file_names_apply() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with src as (
    select distinct on (af.id) af.id, 'From the old Printavo job #' || ao.visual_id || ': ' || coalesce(nullif(pf.pname, ''), nm.filename) as label
    from art_files af
    join archived_orders ao on ao.id::text = split_part(af.file_path, '/', 2)
    cross join lateral jsonb_each_text(ao.files) f
    left join printavo_file_names nm on nm.handle = public.printavo_handle(f.key) and nm.status = 'ok'
    left join lateral (
      select x->>'name' as pname from jsonb_array_elements(coalesce(ao.data->'files', '[]'::jsonb)) x where x->>'full' = f.key limit 1
    ) pf on true
    where af.file_path like 'printavo/%' and f.value = af.file_path
      and af.name ~* '^(From the old Printavo job|Old mockup)'
      and coalesce(nullif(pf.pname, ''), nm.filename) is not null
  )
  update art_files af set name = left(src.label, 300)
  from src where src.id = af.id and af.name is distinct from left(src.label, 300);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.printavo_file_names_apply() from public, anon, authenticated;

-- files already used on new orders go first
  queued_at timestamptz not null default now(),
  fetched_at timestamptz
);
-- the backfill picks the next waiting handles; errors are retried (3 tries)
create index if not exists printavo_file_names_todo_idx on public.printavo_file_names (priority desc, queued_at) where status is null;
create index if not exists printavo_file_names_retry_idx on public.printavo_file_names (fetched_at) where status in ('error', 'working');
alter table public.printavo_file_names enable row level security;
revoke all on public.printavo_file_names from anon, authenticated;
grant select on public.printavo_file_names to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'printavo_file_names' and policyname = 'printavo_file_names_staff_read') then
    create policy printavo_file_names_staff_read on public.printavo_file_names for select to authenticated using ((select public.is_staff()));
  end if;
end $$;

-- the Filestack handle in a Printavo file link: the LAST handle in it (a thumbnail link is
-- https://cdn.filepicker.io/<api key>/output=format:png/resize=…/https://cdn.filepicker.io/<handle>)
create or replace function public.printavo_handle(p_url text) returns text
language sql immutable set search_path = public as $$
  select substring(p_url from '.*(?:filepicker\.io|filestackcontent\.com|filestackapi\.com)/(?:api/file/)?([A-Za-z0-9]{20})(?:[^A-Za-z0-9]|$)')
$$;

-- queues every Filestack handle on archived orders (one order, or all of them): file links that were copied and any
-- file mentioned in the order's record. Returns how many new handles were queued.
create or replace function public.printavo_file_names_queue(p_archived uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with h as (
    select public.printavo_handle(f.key) handle
    from archived_orders a, jsonb_each_text(a.files) f
    where (p_archived is null or a.id = p_archived)
    union
    select m[1]
    from archived_orders a, regexp_matches(a.data::text, 'filepicker\.io/([A-Za-z0-9]{20})(?![A-Za-z0-9])', 'g') m
    where (p_archived is null or a.id = p_archived)
  )
  insert into printavo_file_names (handle)
  select distinct handle from h where handle is not null
  on conflict (handle) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- the next handles to look up (a run claims them so two runs never fetch the same one)
create or replace function public.printavo_file_names_claim(p_n integer) returns setof text
language plpgsql security definer set search_path = public as $$
begin
  -- a run that was cut off after its last try: given up
  update printavo_file_names set status = 'error', last_error = coalesce(last_error, 'cut off')
  where status = 'working' and fetched_at < now() - interval '10 minutes' and tries >= 3;
  return query
  with fresh as (
    select handle from printavo_file_names where status is null order by priority desc, queued_at limit p_n for update skip locked
  ), again as (
    select handle from printavo_file_names
    where status in ('error', 'working') and tries < 3
      and fetched_at < now() - case when status = 'working' then interval '10 minutes' else interval '2 minutes' end
    order by fetched_at limit p_n for update skip locked
  ), pick as (
    select handle from again union all select handle from fresh limit p_n
  )
  update printavo_file_names f set status = 'working', tries = f.tries + 1, fetched_at = now()
  from pick p where f.handle = p.handle
  returning f.handle;
end $$;

-- how far the backfill is (Import page / reports)
create or replace function public.printavo_file_names_progress() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'total', count(*),
    'ok', count(*) filter (where status = 'ok'),
    'missing', count(*) filter (where status = 'missing'),
    'failed', count(*) filter (where status = 'error' and tries >= 3),
    'left', count(*) filter (where status is null or (status in ('error', 'working') and tries < 3)),
    'last_at', max(fetched_at))
  from printavo_file_names
$$;

-- run every minute by pg_cron while there's anything left; unschedules itself when everything has been looked up
create or replace function public.printavo_file_names_tick() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare t text;
begin
  if not exists (select 1 from printavo_file_names where status is null)
     and not exists (select 1 from printavo_file_names where status in ('error', 'working') and tries < 3) then
    perform cron.unschedule(jobid) from cron.job where jobname = 'printavo-file-names';
    return;
  end if;
  select token::text into t from printavo_sync where id = 1;
  if t is null then return; end if;
  perform net.http_get(
    url := 'https://portal.fbsprint.com/api/printavo/file-names',
    headers := jsonb_build_object('x-sync-token', t),
    timeout_milliseconds := 300000);
end $$;

revoke execute on function public.printavo_file_names_queue(uuid) from public, anon, authenticated;
revoke execute on function public.printavo_file_names_claim(integer) from public, anon, authenticated;
revoke execute on function public.printavo_file_names_tick() from public, anon, authenticated;
revoke execute on function public.printavo_file_names_progress() from public, anon;
grant execute on function public.printavo_file_names_progress() to authenticated;

-- files already used on new orders (reorders of old Printavo jobs) are looked up first
insert into public.printavo_file_names (handle, priority)
select distinct public.printavo_handle(f.key), 1
from public.archived_orders a, jsonb_each_text(a.files) f
where f.value in (select file_path from public.art_files where file_path like 'printavo/%')
  and public.printavo_handle(f.key) is not null
on conflict (handle) do update set priority = 1;

-- (the full queue — public.printavo_file_names_queue() — and the schedule are started once by hand:)
--   select public.printavo_file_names_queue();
--   select cron.schedule('printavo-file-names', '* * * * *', $$select public.printavo_file_names_tick()$$);
