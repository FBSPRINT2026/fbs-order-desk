-- Website leads: Ignore and block (Nov 6, Nick: "we're gonna get a lot of junk on our website… if it comes in to us, we
-- can just automatically ignore"). A blocked email, domain, IP or phone: its next submissions are kept as spam, not made.
create table if not exists public.site_blocks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('email','domain','ip','phone')),
  value text not null,
  reason text,
  sample text,
  order_id uuid,
  created_by text,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create unique index if not exists site_blocks_kv on public.site_blocks (kind, value) where removed_at is null;
alter table public.site_blocks enable row level security;
create policy site_blocks_staff on public.site_blocks for select using (is_staff());
