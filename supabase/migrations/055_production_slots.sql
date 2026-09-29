-- The machine schedule: a job (new order or, until go-live, a Printavo order) booked on a machine for a day.
create table if not exists public.production_slots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  archived_order_id uuid references public.archived_orders(id) on delete cascade,
  machine text not null,
  day date not null,
  position integer not null default 0,
  minutes integer not null default 0,
  kind text not null default 'screen',
  label text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'done')),
  source text not null default 'manual',
  note text not null default '',
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists production_slots_day_idx on public.production_slots (day, machine, position);
create index if not exists production_slots_order_idx on public.production_slots (order_id);
create index if not exists production_slots_arch_idx on public.production_slots (archived_order_id);
alter table public.production_slots enable row level security;
drop policy if exists production_slots_staff on public.production_slots;
create policy production_slots_staff on public.production_slots for all using (public.is_staff()) with check (public.is_staff());
