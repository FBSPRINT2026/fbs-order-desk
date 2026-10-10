-- Canva Connect (Oct 10, 2026): export a customer's Canva design (vector PDF + see-through PNG) with Nick's Canva
-- sign-in, and "Design in Canva" from the Mockup Creator (Canva's editor opens in a new tab; Return in Canva brings the
-- design back as the customer's logo). Additive only; safe to run again.
--
-- The Canva sign-in lives in integration_tokens, name 'canva' (row security on, no policies: server only).
-- Canva's refresh tokens are single use, so a refresh runs under a short lease and the new tokens are saved only if
-- the refresh token is still the one that was used (compare-and-swap), like QuickBooks (120_quickbooks_sync_fixes.sql).

create or replace function public.integration_token_lease(p_name text, p_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update integration_tokens set data = data || jsonb_build_object('refresh_lease_until', now() + make_interval(secs => p_seconds))
  where name = p_name and coalesce((data->>'refresh_lease_until')::timestamptz, 'epoch'::timestamptz) < now() returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function public.integration_token_swap(p_name text, p_old_refresh text, p_new jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update integration_tokens set data = (p_new - 'refresh_lease_until'), updated_at = now(), updated_by = 'refresh'
  where name = p_name and data->>'refresh_token' = p_old_refresh returning true into ok;
  return coalesce(ok, false);
end $$;

revoke execute on function public.integration_token_lease(text, integer) from public, anon, authenticated;
revoke execute on function public.integration_token_swap(text, text, jsonb) from public, anon, authenticated;

-- one "Design in Canva" trip: made here, edited in Canva, back through Return navigation
create table if not exists public.canva_sessions (
  id uuid primary key default gen_random_uuid(),
  correlation_state text not null unique,
  design_id text not null default '',          -- Canva's design id
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid,
  group_id text not null default '',
  side text not null default '',               -- front | back | sleeve
  location text not null default '',           -- the print location the canvas was sized for (e.g. Full Front)
  im_id text not null default '',              -- the imprint the design goes on, when there was one
  width_in numeric,
  height_in numeric,
  return_to text not null default '',          -- the Mockup Creator page to go back to
  status text not null default 'editing' check (status in ('editing', 'returned', 'saved', 'error')),
  error text,
  design_ref uuid,                             -- our designs row, once saved
  from_design uuid,                            -- "Edit in Canva" on one of our designs: the design it started from
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists canva_sessions_created_idx on public.canva_sessions (created_at desc);
alter table public.canva_sessions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'canva_sessions' and policyname = 'canva_sessions_staff_read') then
    create policy canva_sessions_staff_read on public.canva_sessions for select using ((select public.is_staff()));
  end if;
end $$;

-- a design that came from Canva remembers which Canva design it was, to offer "Edit in Canva" again
alter table public.designs add column if not exists canva_design_id text;
