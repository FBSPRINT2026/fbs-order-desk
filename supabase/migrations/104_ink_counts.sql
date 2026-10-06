-- Ink inventory: each count of a stock ink (a Monday-morning inventory, or a one-off adjustment). On hand is the latest
-- count; the Ink Room subtracts the estimated ink of screen jobs finished since then and walks the schedule forward to
-- say when each ink runs out and what to order. Counts are kept (never deleted) as the history.
create table if not exists public.ink_counts (
  id uuid primary key default gen_random_uuid(),
  stock_ink_id uuid not null references public.stock_inks(id),
  grams numeric not null check (grams >= 0),
  entered text not null default '',
  kind text not null default 'count' check (kind in ('count', 'adjust')),
  session uuid,
  note text not null default '',
  counted_by text not null default '',
  counted_at timestamptz not null default now()
);
create index if not exists ink_counts_ink_idx on public.ink_counts (stock_ink_id, counted_at desc);
alter table public.ink_counts enable row level security;
create policy ink_counts_staff on public.ink_counts for all using (public.is_staff()) with check (public.is_staff());
