-- PMS batches mixed in the ink room: when a color was made, how much, by whom, and for which job. The last batch tells
-- the crew whether some is probably still on the shelf (made recently) or it's time to just mix it (made long ago).
-- Logged from the job's phone menu ("Make") or the Ink Room. Kept as history; archived, never deleted.
create table if not exists public.ink_batches (
  id uuid primary key default gen_random_uuid(),
  code text not null,                       -- the formula's code as IMS shows it ("123 C", "P 7-6 C")
  system text not null default 'RX',
  formula_id uuid references public.ink_formulas(id),
  qt numeric not null check (qt > 0),       -- amount made, in quarts
  grams numeric,
  order_id uuid references public.orders(id),
  archived_order_id uuid references public.archived_orders(id),
  job text not null default '',             -- "#1461 Spring Tees", for the history
  note text not null default '',
  made_by text not null default '',
  employee_id uuid,
  made_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists ink_batches_code_idx on public.ink_batches (system, upper(code), made_at desc);
alter table public.ink_batches enable row level security;
create policy ink_batches_staff on public.ink_batches for all using (public.is_staff()) with check (public.is_staff());
