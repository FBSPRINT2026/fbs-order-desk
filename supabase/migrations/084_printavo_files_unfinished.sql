-- archived orders with Printavo files that didn't copy ("failed" / "too-big"), for the Import page's report (server only)
create or replace function public.printavo_files_unfinished(p_mark text default null)
returns table (id uuid, printavo_id text, visual_id text, order_date date, nickname text, files jsonb, data jsonb)
language sql stable security definer set search_path = public as $$
  select a.id, a.printavo_id, a.visual_id, a.order_date, a.nickname, a.files, a.data
  from archived_orders a
  where exists (select 1 from jsonb_each_text(a.files) e where e.value in ('failed', 'too-big') and (p_mark is null or e.value = p_mark))
  order by a.order_date desc;
$$;
revoke all on function public.printavo_files_unfinished(text) from public, anon, authenticated;
grant execute on function public.printavo_files_unfinished(text) to service_role;
