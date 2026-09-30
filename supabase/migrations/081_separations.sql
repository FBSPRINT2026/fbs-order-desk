-- Separations: one per screen-print imprint that needs films. Requested from the order once it's approved, worked in
-- the Separation Studio (our own engine) or brought back from outside software (Separo…), reviewed, approved.
-- Files (plates, composite preview, films PDF, uploads) live in the private proofs bucket under separations/<id>/.
create table if not exists public.separations (
  id uuid primary key default gen_random_uuid(),
  number serial,
  order_id uuid references public.orders(id) on delete set null,
  group_id text,
  imprint_id text,
  location text not null default '',
  design_id uuid references public.designs(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  garment_color text not null default '',
  status text not null default 'requested' check (status in ('requested', 'in_progress', 'review', 'approved', 'films', 'cancelled')),
  method text not null default 'spot' check (method in ('spot', 'sim', 'index', 'outside')),
  source text not null default 'studio',
  settings jsonb not null default '{}'::jsonb,
  -- [{ key, name, ink, hex, kind: 'underbase'|'color'|'highlight', order, mesh, file, coverage }]
  channels jsonb not null default '[]'::jsonb,
  -- [{ path, name, kind: 'plate'|'preview'|'films'|'upload', size }]
  files jsonb not null default '[]'::jsonb,
  preview_path text,
  notes text not null default '',
  due_date date,
  requested_by text not null default '',
  assigned_to text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists separations_status_idx on public.separations (status, created_at desc);
create index if not exists separations_order_idx on public.separations (order_id);
create unique index if not exists separations_imprint_open on public.separations (order_id, imprint_id) where status <> 'cancelled';
alter table public.separations enable row level security;
drop policy if exists separations_staff on public.separations;
create policy separations_staff on public.separations for all using (public.is_staff()) with check (public.is_staff());
