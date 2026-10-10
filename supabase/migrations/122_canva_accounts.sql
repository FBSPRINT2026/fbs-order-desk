-- Canva for customers (Oct 10, 2026): each person can connect their OWN Canva account (Canva's editor links only work
-- for the account that owns the design), so customers design in Canva from their portal's Mockup Creator.
-- The shop's connection (integration_tokens 'canva', used for email-link exports) stays as it is.
-- Additive only; safe to run again.

-- one row per person (a portal customer or staff) who connected their Canva account. Tokens never leave the server:
-- row security on and NO policies (only the service role reads or writes it).
create table if not exists public.canva_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  email text not null default '',
  canva_user_id text not null default '',
  canva_team_id text not null default '',
  display_name text not null default '',
  tokens jsonb not null default '{}'::jsonb,   -- access_token, refresh_token, access_expires_at, refresh_lease_until
  connected_at timestamptz,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists canva_accounts_customer_idx on public.canva_accounts (customer_id);
alter table public.canva_accounts enable row level security;

-- refresh one person's sign-in under a short lease, and save the new tokens only if the refresh token is still the
-- one that was used (Canva's refresh tokens are single use): same as integration_token_lease / _swap
create or replace function public.canva_account_lease(p_user uuid, p_seconds integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update canva_accounts set tokens = tokens || jsonb_build_object('refresh_lease_until', now() + make_interval(secs => p_seconds))
  where user_id = p_user and coalesce((tokens->>'refresh_lease_until')::timestamptz, 'epoch'::timestamptz) < now() returning true into ok;
  return coalesce(ok, false);
end $$;
create or replace function public.canva_account_swap(p_user uuid, p_old_refresh text, p_new jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare ok boolean;
begin
  update canva_accounts set tokens = (p_new - 'refresh_lease_until'), updated_at = now()
  where user_id = p_user and tokens->>'refresh_token' = p_old_refresh returning true into ok;
  return coalesce(ok, false);
end $$;
revoke execute on function public.canva_account_lease(uuid, integer) from public, anon, authenticated;
revoke execute on function public.canva_account_swap(uuid, text, jsonb) from public, anon, authenticated;

-- a Design-with-Canva trip now says whose Canva account it uses ('shop' or 'user') and who started it
alter table public.canva_sessions add column if not exists user_id uuid;
alter table public.canva_sessions add column if not exists account text not null default 'shop';
