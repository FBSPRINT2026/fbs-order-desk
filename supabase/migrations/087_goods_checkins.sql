-- Check-In: receiving counts a job's goods in, size by size (like DecoNetwork's receive-stock screen and Printavo
-- receiving). One row per count. Differences (short, over, damaged, wrong item) are kept on the lines and make the
-- check-in an open problem in Goods & Receiving until someone resolves it.
-- A job is either an order here (order_id) or, until go-live, a Printavo job (archived_order_id, read-only copy).
create table if not exists public.goods_checkins (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  archived_order_id uuid references public.archived_orders(id) on delete cascade,
  -- [{ item, style, color, size, expected, received, issue: '' | 'short' | 'over' | 'damaged' | 'mispick', bad, note }]
  lines jsonb not null default '[]'::jsonb,
  expected integer not null default 0,
  received integer not null default 0,
  boxes integer,
  source text not null default '',            -- 'manifest' | 'order': where the expected counts came from
  status text not null default 'complete' check (status in ('complete', 'issue')),
  note text not null default '',
  photos jsonb not null default '[]'::jsonb,  -- storage paths (proofs bucket, checkins/<id>/…)
  by text not null default '',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text not null default '',
  resolution text not null default '',
  constraint goods_checkins_job check (order_id is not null or archived_order_id is not null)
);
create index if not exists goods_checkins_order_idx on public.goods_checkins (order_id, created_at desc);
create index if not exists goods_checkins_archived_idx on public.goods_checkins (archived_order_id, created_at desc);
create index if not exists goods_checkins_open_idx on public.goods_checkins (status, resolved_at);
alter table public.goods_checkins enable row level security;
drop policy if exists goods_checkins_staff on public.goods_checkins;
create policy goods_checkins_staff on public.goods_checkins for all using (public.is_staff()) with check (public.is_staff());
