-- (superseded by 029_printavo_sync.sql, which drops this table) "Import everything" queue, one row per Printavo customer.
create table if not exists public.printavo_queue (
  printavo_id text primary key,
  company text not null default '',
  contact text not null default '',
  order_count integer not null default 0,
  position integer not null default 0,
  status text not null default 'pending' check (status in ('pending','done','error')),
  customer_id uuid references public.customers(id) on delete set null,
  orders_done integer not null default 0,
  files_done integer not null default 0,
  problems integer not null default 0,
  error text,
  listed_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.printavo_queue enable row level security;
