-- Printavo sync by time frame (Oct 26, Nick: "you're only updating everything within the last 30 days normally, but
-- then… twice a day at like noon and then maybe at midnight, you maybe do like a 90-day run… And then if we click in the
-- sync tool to run sync… what would you like to sync? And I could select the time frame"). One run at a time: it walks
-- Printavo's order list newest first back to range_since and brings over what's new or changed. Read-only toward Printavo.
alter table public.printavo_sync add column if not exists range_since timestamptz;
alter table public.printavo_sync add column if not exists range_label text;
alter table public.printavo_sync add column if not exists range_cursor text;
alter table public.printavo_sync add column if not exists range_pages integer not null default 0;
alter table public.printavo_sync add column if not exists range_seen integer not null default 0;
alter table public.printavo_sync add column if not exists range_changed integer not null default 0;
alter table public.printavo_sync add column if not exists range_started_at timestamptz;
alter table public.printavo_sync add column if not exists range_done_at timestamptz;
alter table public.printavo_sync add column if not exists range_by text;
alter table public.printavo_sync add column if not exists range_auto_at timestamptz;

grant select (range_since, range_label, range_pages, range_seen, range_changed, range_started_at, range_done_at, range_by, range_auto_at) on public.printavo_sync to authenticated;

-- staff start a run (days back from now; history before 2026 is locked and never re-read)
create or replace function public.printavo_sync_range(p_days integer, p_label text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Only shop staff can run the Printavo sync'; end if;
  if p_days is null or p_days < 1 or p_days > 400 then raise exception 'Pick a time frame between 1 and 400 days'; end if;
  update public.printavo_sync set
    range_since = greatest(now() - make_interval(days => p_days), '2026-01-01'::timestamptz),
    range_label = coalesce(nullif(trim(p_label), ''), 'Last ' || p_days || ' days'),
    range_cursor = null, range_pages = 0, range_seen = 0, range_changed = 0,
    range_started_at = now(), range_done_at = null,
    range_by = coalesce(auth.jwt() ->> 'email', 'staff')
  where id = 1;
end $$;
grant execute on function public.printavo_sync_range(integer, text) to authenticated;
