-- Shop-only notes and photos on a job (from the phone after scanning the job's QR, or from the job page): press setup
-- changes, ink / color changes, photos of the printed piece. Staff only (the server writes them for employees).
create table if not exists public.job_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  archived_order_id uuid references public.archived_orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  kind text not null default 'note' check (kind in ('note','photo','file')),
  tag text not null default '',
  body text not null default '',
  file_path text not null default '',
  file_name text not null default '',
  file_type text not null default '',
  size integer not null default 0,
  by_name text not null default '',
  by_email text not null default '',
  employee_id uuid,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  check (order_id is not null or archived_order_id is not null)
);
create index if not exists job_files_order_idx on public.job_files (order_id) where order_id is not null;
create index if not exists job_files_archived_idx on public.job_files (archived_order_id) where archived_order_id is not null;
create index if not exists job_files_customer_idx on public.job_files (customer_id) where customer_id is not null;
alter table public.job_files enable row level security;
create policy job_files_staff on public.job_files for all using (public.is_staff()) with check (public.is_staff());

-- Label printing (Zebra ZT231): labels wait here until a print computer's relay (or PrintNode) sends them to the printer.
create table if not exists public.print_relays (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Shop computer',
  token_hash text not null unique,
  last_seen_at timestamptz,
  revoked boolean not null default false,
  created_by text not null default '',
  created_at timestamptz not null default now()
);
alter table public.print_relays enable row level security;
create policy print_relays_staff on public.print_relays for all using (public.is_staff()) with check (public.is_staff());

create table if not exists public.print_jobs (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  kind text not null default 'label',
  zpl text not null,
  copies integer not null default 1,
  status text not null default 'queued' check (status in ('queued','sent','printed','error','expired')),
  error text not null default '',
  relay_id uuid references public.print_relays(id) on delete set null,
  order_id uuid, archived_order_id uuid,
  created_by text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  done_at timestamptz
);
create index if not exists print_jobs_queue_idx on public.print_jobs (created_at) where status = 'queued';
alter table public.print_jobs enable row level security;
create policy print_jobs_staff on public.print_jobs for all using (public.is_staff()) with check (public.is_staff());

-- A relay picks up the waiting labels (each label goes to one relay only). Labels older than 15 minutes are dropped
-- so a computer coming back online doesn't print a pile of old labels.
create or replace function public.claim_print_jobs(p_relay uuid, p_max int default 10)
returns setof public.print_jobs language plpgsql security definer set search_path = public as $$
begin
  update print_jobs set status = 'expired', error = 'Not printed within 15 minutes' where status = 'queued' and created_at < now() - interval '15 minutes';
  return query
    update print_jobs p set status = 'sent', relay_id = p_relay, sent_at = now()
    where p.id in (select id from print_jobs where status = 'queued' order by created_at limit p_max for update skip locked)
    returning p.*;
end $$;
revoke all on function public.claim_print_jobs(uuid, int) from public, anon, authenticated;
