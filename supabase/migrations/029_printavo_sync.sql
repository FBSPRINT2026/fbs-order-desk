-- Printavo sync: import everything, then keep it up to date. READ-ONLY toward Printavo (see lib/printavo.ts assertReadOnly).
-- A database schedule calls /api/printavo/sync every minute; the server does the work, so no browser needs to stay open.
drop table if exists public.printavo_queue;
drop table if exists public.printavo_probe; -- temporary review table

-- one row: on/off switch, where the sweep is, and the key the schedule uses to call the server
create table if not exists public.printavo_sync (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  token uuid not null default gen_random_uuid(),   -- sent by the schedule; only the database and the server can read it
  sweep_cursor text,                                -- where the current pass through Printavo's order list is
  sweep_no integer not null default 0,              -- how many passes are finished
  sweep_started_at timestamptz,
  sweep_done_at timestamptz,
  customers_cursor text,
  customers_done_at timestamptz,
  last_run_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.printavo_sync (id) values (1) on conflict do nothing;
alter table public.printavo_sync enable row level security;
-- staff can see the status (not the token: the page reads it through printavo_sync_status) and flip the switch
drop policy if exists printavo_sync_staff on public.printavo_sync;
revoke all on public.printavo_sync from anon, authenticated;
grant select (id, enabled, sweep_no, sweep_started_at, sweep_done_at, customers_done_at, last_run_at, last_error, last_error_at, updated_at) on public.printavo_sync to authenticated;
grant update (enabled) on public.printavo_sync to authenticated;
create policy printavo_sync_staff on public.printavo_sync for all using (public.is_staff()) with check (public.is_staff());

-- every Printavo order we know about, and whether our copy is current
create table if not exists public.printavo_index (
  printavo_id text primary key,
  visual_id text not null default '',
  kind text not null default 'invoice',
  customer_pid text not null default '',
  created_at timestamptz,
  fingerprint text not null default '',          -- updated time, total, balance, status, due date, customer
  imported_fingerprint text,                     -- the fingerprint when we last imported it
  status text not null default 'pending' check (status in ('pending','files','done','error','gone')),
  archived_id uuid references public.archived_orders(id) on delete set null,
  attempts integer not null default 0,
  error text,
  seen_sweep integer not null default 0,
  imported_at timestamptz,
  deep_at timestamptz,                           -- last full re-read (recent orders get one daily)
  listed_at timestamptz not null default now()
);
create index if not exists printavo_index_todo_idx on public.printavo_index (status, created_at desc);
create index if not exists printavo_index_recent_idx on public.printavo_index (created_at desc, deep_at);
create index if not exists printavo_index_seen_idx on public.printavo_index (seen_sweep);
alter table public.printavo_index enable row level security;
drop policy if exists printavo_index_staff on public.printavo_index;
create policy printavo_index_staff on public.printavo_index for all using (public.is_staff()) with check (public.is_staff());

-- the server claims a job for a while so two runs never do the same work (and never exceed Printavo's request limit)
create table if not exists public.printavo_sync_locks (job text primary key, until timestamptz not null);
alter table public.printavo_sync_locks enable row level security;
revoke all on public.printavo_sync_locks from anon, authenticated;

create or replace function public.printavo_sync_claim(p_job text, p_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  insert into printavo_sync_locks (job, until) values (p_job, now() + make_interval(secs => p_seconds))
  on conflict (job) do update set until = excluded.until where printavo_sync_locks.until < now()
  returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function public.printavo_sync_release(p_job text) returns void
language sql security definer set search_path = public as $$ update printavo_sync_locks set until = now() - interval '1 second' where job = p_job $$;
revoke execute on function public.printavo_sync_claim(text, integer) from public, anon, authenticated;
revoke execute on function public.printavo_sync_release(text) from public, anon, authenticated;

-- progress for the Import page (staff only)
create or replace function public.printavo_sync_status() returns jsonb
language sql stable security definer set search_path = public, storage as $$
  select case when not public.is_staff() then null else jsonb_build_object(
    'enabled', s.enabled, 'sweep_no', s.sweep_no, 'sweep_started_at', s.sweep_started_at, 'sweep_done_at', s.sweep_done_at,
    'customers_done_at', s.customers_done_at, 'last_run_at', s.last_run_at, 'last_error', s.last_error, 'last_error_at', s.last_error_at,
    'listing', s.sweep_no = 0,
    'orders', (select count(*) from printavo_index where status <> 'gone'),
    'pending', (select count(*) from printavo_index where status = 'pending'),
    'files_waiting', (select count(*) from printavo_index where status = 'files'),
    'done', (select count(*) from printavo_index where status = 'done'),
    'errors', (select count(*) from printavo_index where status = 'error'),
    'gone', (select count(*) from printavo_index where status = 'gone'),
    'customers', (select count(*) from printavo_customers),
    'files_total', (select coalesce(sum(files_total), 0) from archived_orders),
    'files_copied', (select coalesce(sum(files_copied), 0) from archived_orders),
    'storage_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'proofs'),
    'oldest_done', (select min(created_at) from printavo_index where status in ('done','files')),
    'last_hour', (select count(*) from printavo_index where imported_at > now() - interval '1 hour'),
    'recent_errors', (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select visual_id, error from printavo_index where status = 'error' order by imported_at desc nulls last limit 8) e)
  ) end from printavo_sync s where s.id = 1;
$$;
revoke execute on function public.printavo_sync_status() from public, anon;
grant execute on function public.printavo_sync_status() to authenticated;

-- the schedule: every minute, one run that talks to Printavo and two that copy files (files don't count against Printavo's limit)
create extension if not exists pg_net;
create extension if not exists pg_cron;
create or replace function public.printavo_sync_tick(p_job text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare s record;
begin
  select enabled, token into s from printavo_sync where id = 1;
  if not s.enabled then return; end if;
  perform net.http_get(
    url := 'https://portal.fbsprint.com/api/printavo/sync?job=' || p_job,
    headers := jsonb_build_object('x-sync-token', s.token::text),
    timeout_milliseconds := 65000);
end $$;
revoke execute on function public.printavo_sync_tick(text) from public, anon, authenticated;
select cron.unschedule(jobname) from cron.job where jobname like 'printavo-sync-%';
select cron.schedule('printavo-sync-api', '* * * * *', $$select public.printavo_sync_tick('api')$$);
select cron.schedule('printavo-sync-files-1', '* * * * *', $$select public.printavo_sync_tick('files-1')$$);
select cron.schedule('printavo-sync-files-2', '* * * * *', $$select public.printavo_sync_tick('files-2')$$);
